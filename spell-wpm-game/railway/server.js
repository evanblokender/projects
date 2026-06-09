import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import { Server } from "socket.io";
import { z } from "zod";
import { createWordSequence, wordPools } from "./words.js";

const { Pool } = pg;
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const configuredOrigins = String(process.env.CLIENT_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters.");
}

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
}

const allowAnyOrigin = configuredOrigins.includes("*");
const corsOrigin = (origin, callback) => {
    if (!origin || allowAnyOrigin || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
    }
    callback(new Error("Origin not allowed."));
};

const databaseHost = new URL(databaseUrl).hostname;
const usesPrivateDatabase = databaseHost === "localhost" || databaseHost.endsWith(".railway.internal");
const pool = new Pool({
    connectionString: databaseUrl,
    ssl: usesPrivateDatabase ? false : { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10000
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 10000
});

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "12kb" }));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many account attempts. Try again later." }
});

const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);

const credentialsSchema = z.object({
    username: z.string()
        .trim()
        .min(3, "Username must be at least 3 characters.")
        .max(18, "Username can contain at most 18 characters.")
        .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers, and underscores."),
    password: z.string()
        .min(8, "Password must be at least 8 characters.")
        .max(72, "Password is too long.")
        .regex(/[A-Za-z]/, "Password needs at least one letter.")
        .regex(/[0-9]/, "Password needs at least one number.")
});

const roomSchema = z.object({
    name: z.string().trim().min(1).max(30),
    mode: z.enum(Object.keys(wordPools)),
    private: z.boolean()
});

const rooms = new Map();
const socketRooms = new Map();
const matchTimers = new Map();

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            username VARCHAR(18) NOT NULL,
            username_key VARCHAR(18) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            wins INTEGER NOT NULL DEFAULT 0,
            races INTEGER NOT NULL DEFAULT 0,
            best_wpm INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function initializeDatabaseWithRetry() {
    let lastError;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
        try {
            await initializeDatabase();
            return;
        } catch (error) {
            lastError = error;
            console.error(`Database connection attempt ${attempt} failed.`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
    throw lastError;
}

function publicUser(row) {
    return {
        id: row.id,
        username: row.username,
        wins: row.wins,
        races: row.races,
        bestWpm: row.best_wpm
    };
}

function createToken(user) {
    return jwt.sign(
        { sub: user.id, username: user.username },
        jwtSecret,
        { expiresIn: "7d", issuer: "spellrush" }
    );
}

function verifyToken(token) {
    return jwt.verify(token, jwtSecret, { issuer: "spellrush" });
}

function authMiddleware(request, response, next) {
    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    try {
        const payload = verifyToken(token);
        request.user = { id: payload.sub, username: payload.username };
        next();
    } catch {
        response.status(401).json({ error: "Your session is invalid or expired." });
    }
}

function createCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
}

function uniqueCode() {
    let code;
    do {
        code = createCode();
    } while ([...rooms.values()].some((room) => room.code === code));
    return code;
}

function publicRoom(room) {
    return {
        id: room.id,
        name: room.name,
        mode: room.mode,
        private: room.private,
        code: room.private ? room.code : null,
        hostId: room.hostId,
        status: room.status,
        maxPlayers: room.maxPlayers,
        players: [...room.players.values()].map((player) => ({
            id: player.id,
            username: player.username,
            connected: player.connected
        }))
    };
}

function roomSummary(room) {
    return {
        id: room.id,
        name: room.name,
        mode: room.mode,
        status: room.status,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers
    };
}

function publicRooms() {
    return [...rooms.values()]
        .filter((room) => !room.private)
        .map(roomSummary)
        .sort((a, b) => {
            if (a.status !== b.status) {
                return a.status === "lobby" ? -1 : 1;
            }
            return b.playerCount - a.playerCount;
        });
}

function broadcastRooms() {
    io.emit("rooms:update", publicRooms());
}

function broadcastRoom(room) {
    io.to(room.id).emit("room:state", publicRoom(room));
}

function findRoomForSocket(socket) {
    const roomId = socketRooms.get(socket.id);
    return roomId ? rooms.get(roomId) : null;
}

function leaveCurrentRoom(socket, notify = true) {
    const room = findRoomForSocket(socket);
    if (!room) {
        return;
    }
    room.players.delete(socket.user.id);
    socketRooms.delete(socket.id);
    socket.leave(room.id);
    if (room.players.size === 0) {
        clearTimeout(matchTimers.get(room.id));
        matchTimers.delete(room.id);
        rooms.delete(room.id);
    } else {
        if (room.hostId === socket.user.id) {
            room.hostId = room.players.keys().next().value;
        }
        if (room.status === "playing") {
            const matchPlayer = room.match.players.get(socket.user.id);
            if (matchPlayer) {
                matchPlayer.connected = false;
            }
            broadcastStandings(room);
        }
        broadcastRoom(room);
    }
    if (notify) {
        socket.emit("room:left");
    }
    broadcastRooms();
}

function joinRoom(socket, room) {
    if (!room) {
        socket.emit("error:message", "That room no longer exists.");
        return;
    }
    if (room.status !== "lobby") {
        socket.emit("error:message", "That race already started.");
        return;
    }
    if (room.players.size >= room.maxPlayers) {
        socket.emit("error:message", "That room is full.");
        return;
    }
    leaveCurrentRoom(socket, false);
    room.players.set(socket.user.id, {
        id: socket.user.id,
        username: socket.user.username,
        connected: true
    });
    socketRooms.set(socket.id, room.id);
    socket.join(room.id);
    broadcastRoom(room);
    broadcastRooms();
}

function standingsFor(room) {
    return [...room.match.players.values()]
        .sort((a, b) => b.completed - a.completed || b.score - a.score || a.totalDuration - b.totalDuration)
        .map((player) => ({
            id: player.id,
            username: player.username,
            completed: player.completed,
            score: player.score,
            connected: player.connected
        }));
}

function broadcastStandings(room) {
    io.to(room.id).emit("match:standings", standingsFor(room));
}

function sendWord(room, userId) {
    const player = room.match.players.get(userId);
    if (!player || player.completed >= room.match.targetWords) {
        return;
    }
    const socket = [...io.sockets.sockets.values()].find((candidate) => candidate.user?.id === userId);
    socket?.emit("match:word", {
        word: room.match.words[player.wordIndex],
        completed: player.completed
    });
    player.wordStartedAt = Date.now();
}

async function endMatch(room, reason) {
    if (!room || room.status !== "playing") {
        return;
    }
    room.status = "finished";
    clearTimeout(matchTimers.get(room.id));
    matchTimers.delete(room.id);
    const standings = standingsFor(room);
    const winner = standings[0];
    io.to(room.id).emit("match:ended", { reason, standings });
    try {
        const ids = standings.map((player) => player.id);
        if (ids.length) {
            await pool.query("UPDATE users SET races = races + 1 WHERE id = ANY($1::uuid[])", [ids]);
        }
        if (winner) {
            await pool.query("UPDATE users SET wins = wins + 1 WHERE id = $1", [winner.id]);
        }
        for (const player of room.match.players.values()) {
            if (player.bestWpm > 0) {
                await pool.query(
                    "UPDATE users SET best_wpm = GREATEST(best_wpm, $1) WHERE id = $2",
                    [player.bestWpm, player.id]
                );
            }
        }
    } catch (error) {
        console.error("Match result persistence failed:", error.message);
    }
    setTimeout(() => {
        const current = rooms.get(room.id);
        if (!current || current.status !== "finished") {
            return;
        }
        current.status = "lobby";
        current.match = null;
        broadcastRoom(current);
        broadcastRooms();
    }, 8000);
    broadcastRooms();
}

app.get("/health", async (request, response) => {
    try {
        await pool.query("SELECT 1");
        response.json({ status: "ok", service: "spellrush" });
    } catch {
        response.status(503).json({ status: "database unavailable" });
    }
});

app.post("/api/auth/register", async (request, response) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
        response.status(400).json({ error: parsed.error.issues[0].message });
        return;
    }
    const { username, password } = parsed.data;
    const usernameKey = username.toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE username_key = $1", [usernameKey]);
    if (existing.rowCount) {
        response.status(409).json({ error: "That username is already taken." });
        return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    try {
        const result = await pool.query(
            `INSERT INTO users (id, username, username_key, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, wins, races, best_wpm`,
            [id, username, usernameKey, passwordHash]
        );
        const user = publicUser(result.rows[0]);
        response.status(201).json({ token: createToken(user), user });
    } catch (error) {
        if (error.code === "23505") {
            response.status(409).json({ error: "That username is already taken." });
            return;
        }
        throw error;
    }
});

app.post("/api/auth/login", async (request, response) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
        response.status(400).json({ error: "Enter a valid username and password." });
        return;
    }
    const result = await pool.query(
        `SELECT id, username, password_hash, wins, races, best_wpm
         FROM users
         WHERE username_key = $1`,
        [parsed.data.username.toLowerCase()]
    );
    const row = result.rows[0];
    const valid = row ? await bcrypt.compare(parsed.data.password, row.password_hash) : false;
    if (!valid) {
        response.status(401).json({ error: "Incorrect username or password." });
        return;
    }
    const user = publicUser(row);
    response.json({ token: createToken(user), user });
});

app.get("/api/me", authMiddleware, async (request, response) => {
    const result = await pool.query(
        "SELECT id, username, wins, races, best_wpm FROM users WHERE id = $1",
        [request.user.id]
    );
    if (!result.rowCount) {
        response.status(404).json({ error: "Account not found." });
        return;
    }
    response.json({ user: publicUser(result.rows[0]) });
});

app.get("/api/rooms", authMiddleware, (request, response) => {
    response.json({ rooms: publicRooms() });
});

app.use((error, request, response, next) => {
    console.error(error);
    if (response.headersSent) {
        next(error);
        return;
    }
    response.status(500).json({ error: "Unexpected server error." });
});

io.use((socket, next) => {
    try {
        const payload = verifyToken(socket.handshake.auth?.token || "");
        socket.user = { id: payload.sub, username: payload.username };
        next();
    } catch {
        next(new Error("Unauthorized"));
    }
});

io.on("connection", (socket) => {
    socket.emit("rooms:update", publicRooms());

    socket.on("room:create", (payload) => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) {
            socket.emit("error:message", parsed.error.issues[0].message);
            return;
        }
        leaveCurrentRoom(socket, false);
        const id = crypto.randomUUID();
        const room = {
            id,
            name: parsed.data.name,
            mode: parsed.data.mode,
            private: parsed.data.private,
            code: parsed.data.private ? uniqueCode() : null,
            hostId: socket.user.id,
            status: "lobby",
            maxPlayers: 8,
            players: new Map(),
            match: null
        };
        rooms.set(id, room);
        joinRoom(socket, room);
    });

    socket.on("room:join", ({ roomId } = {}) => {
        joinRoom(socket, rooms.get(roomId));
    });

    socket.on("room:join-code", ({ code } = {}) => {
        const normalized = String(code || "").trim().toUpperCase();
        const room = [...rooms.values()].find((candidate) => candidate.private && candidate.code === normalized);
        joinRoom(socket, room);
    });

    socket.on("room:quick-join", () => {
        const room = [...rooms.values()].find((candidate) =>
            !candidate.private &&
            candidate.status === "lobby" &&
            candidate.players.size < candidate.maxPlayers
        );
        if (room) {
            joinRoom(socket, room);
            return;
        }
        const id = crypto.randomUUID();
        const newRoom = {
            id,
            name: "Open Sprint",
            mode: "Normal",
            private: false,
            code: null,
            hostId: socket.user.id,
            status: "lobby",
            maxPlayers: 8,
            players: new Map(),
            match: null
        };
        rooms.set(id, newRoom);
        joinRoom(socket, newRoom);
    });

    socket.on("room:leave", () => leaveCurrentRoom(socket));

    socket.on("match:start", () => {
        const room = findRoomForSocket(socket);
        if (!room || room.hostId !== socket.user.id || room.status !== "lobby") {
            socket.emit("error:message", "Only the host can start this room.");
            return;
        }
        if (room.players.size < 2) {
            socket.emit("error:message", "At least two players are needed to start a competition.");
            return;
        }
        room.status = "playing";
        const durationMs = 90000;
        room.match = {
            targetWords: 12,
            startedAt: Date.now(),
            endsAt: Date.now() + durationMs,
            words: createWordSequence(room.mode),
            players: new Map(
                [...room.players.values()].map((player) => [player.id, {
                    ...player,
                    completed: 0,
                    wordIndex: 0,
                    score: 0,
                    totalDuration: 0,
                    wordStartedAt: Date.now(),
                    bestWpm: 0,
                    lastSubmissionAt: 0
                }])
            )
        };
        io.to(room.id).emit("match:started", {
            startedAt: room.match.startedAt,
            endsAt: room.match.endsAt,
            targetWords: room.match.targetWords
        });
        for (const userId of room.match.players.keys()) {
            sendWord(room, userId);
        }
        broadcastStandings(room);
        matchTimers.set(room.id, setTimeout(() => endMatch(room, "time"), durationMs));
        broadcastRooms();
    });

    socket.on("match:finish-word", ({ word, clientDuration } = {}) => {
        const room = findRoomForSocket(socket);
        if (!room || room.status !== "playing" || Date.now() > room.match.endsAt) {
            return;
        }
        const player = room.match.players.get(socket.user.id);
        if (!player || player.completed >= room.match.targetWords) {
            return;
        }
        const expected = room.match.words[player.wordIndex];
        const now = Date.now();
        const serverDuration = now - player.wordStartedAt;
        const submittedDuration = Number(clientDuration);
        const validDuration = Number.isFinite(submittedDuration) && Math.abs(submittedDuration - serverDuration) < 2500;
        if (word !== expected || serverDuration < 180 || !validDuration || now - player.lastSubmissionAt < 150) {
            socket.emit("error:message", "That word result was rejected.");
            sendWord(room, socket.user.id);
            return;
        }
        player.lastSubmissionAt = now;
        player.completed += 1;
        player.wordIndex += 1;
        player.totalDuration += serverDuration;
        const wpm = Math.round((expected.length / 5) / (serverDuration / 60000));
        player.bestWpm = Math.max(player.bestWpm, Math.min(wpm, 400));
        const speedBonus = Math.max(0, Math.min(25, Math.round((180 - wpm) / -4 + 25)));
        player.score += 100 + speedBonus;
        broadcastStandings(room);
        if (player.completed >= room.match.targetWords) {
            endMatch(room, "target");
            return;
        }
        sendWord(room, socket.user.id);
    });

    socket.on("disconnect", () => leaveCurrentRoom(socket, false));
});

await initializeDatabaseWithRetry();
server.listen(port, "0.0.0.0", () => {
    console.log(`SpellRush server listening on port ${port}`);
});

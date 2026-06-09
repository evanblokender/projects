# SpellRush Railway Server

1. Create a Railway project.
2. Add a PostgreSQL database to the project.
3. Deploy this folder or upload `railway.zip`.
4. Add `JWT_SECRET` with at least 32 random characters.
5. Add `CLIENT_ORIGIN` with the exact URL of the static site.
6. Railway supplies `DATABASE_URL` and `PORT` automatically.
7. Generate a public Railway domain.
8. Open SpellRush settings on the static site and paste that domain into Railway API URL.

The database tables are created automatically on startup. Accounts use bcrypt password hashes, JWT sessions, request rate limits, validated usernames, prepared SQL parameters, protected Socket.IO connections, and server-controlled match state.

export const wordPools = {
    Easy: [
        "apple", "bright", "chair", "dance", "earth", "fresh", "giant", "house", "juice", "light",
        "music", "ocean", "plant", "quick", "river", "smile", "table", "voice", "water", "young",
        "beach", "cloud", "dream", "flame", "grape", "happy", "laugh", "mouse", "night", "stone"
    ],
    Normal: [
        "absolute", "adventure", "brilliant", "calendar", "champion", "creative", "decision", "electric",
        "festival", "freedom", "gravity", "harmony", "journey", "language", "machine", "natural",
        "opinion", "popular", "quality", "reaction", "science", "special", "station", "success",
        "thought", "traffic", "victory", "weather", "welcome", "wonderful"
    ],
    Hard: [
        "acquaintance", "architecture", "bureaucracy", "conscience", "convenience", "discipline",
        "entrepreneur", "exaggerate", "fluorescent", "guarantee", "independent", "maintenance",
        "millennium", "necessary", "occasionally", "parliament", "perseverance", "questionnaire",
        "rhythmical", "surveillance", "temperature", "threshold", "unforeseen", "vocabulary"
    ],
    "Super Hard": [
        "anthropomorphism", "circumlocution", "counterintuitive", "deinstitutionalize",
        "electromagnetism", "extraterritorial", "gastroenterology", "heterogeneous",
        "incomprehensibility", "interdisciplinary", "mischaracterization", "photosynthesis",
        "psychoanalysis", "recontextualize", "semiautobiographical", "thermodynamics",
        "unconstitutionality", "ventriloquism"
    ]
};

export function createWordSequence(mode, count = 40) {
    const pool = wordPools[mode] || wordPools.Normal;
    const result = [];
    let previous = "";
    for (let index = 0; index < count; index += 1) {
        const choices = pool.filter((word) => word !== previous);
        const word = choices[Math.floor(Math.random() * choices.length)];
        result.push(word);
        previous = word;
    }
    return result;
}

# SpellRush on Railway

## Deploy

1. Create a new Railway project.
2. Click `+ New`, choose `Database`, then choose `PostgreSQL`.
3. Add an empty service and deploy the contents of `railway.zip` to that service.
4. Open the app service's `Variables` tab.
5. Click `Add Reference Variable` and select `DATABASE_URL` from the Postgres service.
6. Add `JWT_SECRET` with at least 32 random characters.
7. Add `CLIENT_ORIGIN` with the exact URL of the static website.
8. Deploy the staged changes.
9. Open `Settings`, then `Networking`, and generate a public domain for the app service.
10. Paste that public domain into the static site's `Railway API URL` setting.

The resulting app variable points to `${{Postgres.DATABASE_URL}}`. It stays synchronized with Railway's Postgres credentials and uses Railway's private network. Do not expose the database itself publicly.

The server creates the account table automatically. Usernames, bcrypt password hashes, wins, race totals, and best WPM values are stored in Railway Postgres.

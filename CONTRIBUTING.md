# Contributing

Thanks for helping. CAIRN is small on purpose, so a short note before a large change saves everyone time: open an issue first.

## Set up
See [Run it locally](README.md#run-it-locally). Before opening a pull request:

```bash
npm run build      # type-checks the API and builds the web app
npm test           # needs a cairn_test PostgreSQL database
```

## Ground rules
- **Scores are computed by code, never by a model.** `server/src/domain/score.ts` is the only place a score is made.
- **Ownership comes from the session.** Never read a user id from a request parameter, path or body.
- **No invented data.** If a source is unavailable, keep the last verified value and mark it stale.
- **Security-relevant change?** Add a test to `server/test/security.test.ts` and update [SECURITY.md](SECURITY.md).
- Never commit `.env`, tokens, or real people's data.

# Express Backend Reference

This is the retired TypeScript/Express backend. It was moved out of the repo
root after the Go backend completed the local browser smoke milestone, so it
cannot be started accidentally with `npm run dev --prefix backend`.

Use this package only to inspect legacy behavior while porting or debugging the
Go backend. Do not add new product features here.

If a deliberate comparison run is needed, use a disposable Supabase/R2 setup:

```bash
npm install --prefix reference/express-backend
cp reference/express-backend/.env.example reference/express-backend/.env
npm run dev --prefix reference/express-backend
```

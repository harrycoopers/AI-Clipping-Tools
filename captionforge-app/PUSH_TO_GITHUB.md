# Pushing CaptionForge to a new GitHub repo

You'll do this from your own machine (these commands need your GitHub login).

## Option A — with the GitHub CLI (easiest)

```bash
# from inside the unzipped captionforge-app folder
git init
git add .
git commit -m "Initial commit: CaptionForge"

# creates the repo AND pushes in one step (you'll be prompted to log in once)
gh repo create captionforge --public --source=. --remote=origin --push
```

Don't have the CLI? Install it from https://cli.github.com, or use Option B.

## Option B — create the repo on github.com first

1. Go to https://github.com/new, name it `captionforge`, **don't** add a README
   or .gitignore (this project already has them), and click **Create**.
2. Copy the repo URL it shows you, then run:

```bash
# from inside the unzipped captionforge-app folder
git init
git add .
git commit -m "Initial commit: CaptionForge"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/captionforge.git
git push -u origin main
```

## After it's pushed

```bash
npm install
cp .env.example .env.local   # add your OpenAI key (optional)
npm run dev                  # http://localhost:3000
```

`node_modules`, `.next` and `.env*` are already in `.gitignore`, so your
dependencies and secrets won't be committed.

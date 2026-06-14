# SplitSnap — Deploy to Vercel in 5 minutes

## 1. Get your Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account (free)
3. Click **API Keys** → **Create Key**
4. Copy the key — you'll need it in step 3

## 2. Push to GitHub

```bash
cd splitsnap
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/splitsnap.git
git push -u origin main
```

## 3. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `splitsnap` GitHub repo
3. In **Environment Variables**, add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key from step 1
4. Click **Deploy**

That's it — you'll get a live URL like `splitsnap.vercel.app`.

## Running locally

```bash
cd splitsnap
npm install
cp .env.example .env.local
# Edit .env.local and paste your Anthropic API key
npm run dev
# Open http://localhost:3000
```

## How it works

| Step | What happens |
|------|-------------|
| **Scan** | You upload/photo a receipt → sent to Claude Vision → returns structured JSON of every line item, tax, and total |
| **People** | You name everyone at the table |
| **Voice** | You record (or type) who got what → Claude interprets natural language and assigns items |
| **Results** | Tax and tip distributed proportionally; tap any person to see their itemized breakdown |

## Notes

- Voice recording uses the browser's built-in Web Speech API — works best in Chrome/Edge
- All data stays in your browser session; nothing is stored server-side
- Shared items (e.g. "John and Sarah split the nachos") are supported

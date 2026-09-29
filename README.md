# DocySign

DocySign is a DocuSign-style web app for sending PDF documents out for electronic signature. Teams can upload a contract, place signature fields, route it to teammates or managers, collect signatures, and download a completed PDF with an audit trail.

## Features

- Sign up, log in, and log out
- Upload a PDF or start from a sample NDA
- Add recipients (needs to sign / needs to approve)
- Place, move, and delete fields: signature, initials, full name, date, text
- Draw or type a signature
- In-app mailbox: signing requests and completed-document notices
- Inbox of documents waiting on you
- Completed library shared with every party on the envelope
- Preview, print, and download the original or stamped PDF
- Certificate of completion and audit trail when everyone has signed

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React 18, Vite 6, React Router, pdf.js |
| Backend | Node.js, Express, multer, pdf-lib |
| Storage | JSON file store (`backend/data/`) and uploaded PDFs (`backend/uploads/`) |

Email is in-app (the Mail page), not SMTP. Recipients who sign up with the same email as the envelope see requests in Mail and To sign.

## Project structure

```text
backend/          API server (port 3001)
frontend/         React app (port 5173, proxies /api to the backend)
start.sh          Starts backend and frontend together
```

## Requirements

- Node.js 18 or later
- npm

## Setup

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

## Run locally

Start the API, then the UI. The Vite dev server proxies `/api` to `http://127.0.0.1:3001`.

```bash
# Terminal 1
cd backend
npm start

# Terminal 2
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Or from the repo root:

```bash
bash start.sh
```

## How to use it

1. Create an account (Try free) or sign in.
2. In Workspace, upload a PDF or click Use sample NDA.
3. Add recipients with name and email.
4. Place fields on the PDF for each person. Click the X on a box, or Delete in Placed fields, to remove it.
5. Send for signature. Each recipient gets an in-app email with a signing link.
6. Open Mail or To sign, fill the fields, and finish signing.
7. When everyone has signed, the final PDF is emailed to all parties and appears under Completed. Preview, print, or download it from there.

Use two accounts with different emails to demo the full loop (sender and signer).

## Main routes

| Path | Page |
| --- | --- |
| `/` | Landing |
| `/signup` `/login` | Accounts |
| `/app` | Workspace (Sent, To sign, Completed) |
| `/mail` | In-app mailbox |
| `/prepare/:id` | Place fields and send |
| `/envelope/:id` | Envelope status and audit trail |
| `/preview/:id` | Preview / print / download |
| `/sign/:token` | Signing session (no login required) |

## API

The backend listens on port 3001.

- `POST /api/auth/signup` `POST /api/auth/login` `GET /api/auth/me`
- `GET/POST /api/envelopes` `PUT /api/envelopes/:id` `POST /api/envelopes/:id/send`
- `GET /api/inbox` `GET /api/library` `GET /api/stats` `GET /api/mail`
- `GET/POST /api/sign/:token`

PDFs are stored under `backend/uploads/`. User, envelope, and mail data live in `backend/data/`. Both directories are gitignored.

## License

Private project. Update this section if you want to publish under an open-source license.

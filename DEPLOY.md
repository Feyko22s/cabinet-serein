# Cabinet Serein — Déploiement Railway

## Déploiement en 10 minutes

### 1. Crée un compte Railway
Va sur https://railway.app et connecte-toi avec GitHub.

### 2. Déploie le projet
- Clique sur "New Project" → "Deploy from GitHub repo"
- Sélectionne ce repo
- Railway détecte automatiquement Node.js

### 3. Configure les variables d'environnement
Dans Railway → ton projet → "Variables", ajoute :

```
OPENAI_API_KEY=sk-...           ← https://platform.openai.com/api-keys
TWILIO_ACCOUNT_SID=AC...        ← https://console.twilio.com
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+33...
DOCTOR_NAME=Dr. Martin
CABINET_ADDRESS=12 rue de la Paix, Paris
CABINET_PHONE=01 23 45 67 89
OPENING_HOURS=Lundi-Vendredi 9h-12h et 14h-18h
PORT=3000
```

### 4. Configure le webhook Twilio (SMS entrants)
Dans Twilio Console → Phone Numbers → ton numéro :
- Webhook SMS : `https://TON-APP.railway.app/webhook/sms`
- Méthode : POST

### 5. C'est en ligne !
Railway te donne une URL du type : `https://cabinet-serein-production.up.railway.app`

---

## Lancer en local pour tester

```bash
# 1. Copie le fichier d'environnement
cp .env.example .env
# Remplis tes clés dans .env

# 2. Installe les dépendances
npm install

# 3. Lance le serveur
npm start

# 4. Ouvre dans le navigateur
open http://localhost:3000
```

---

## Structure du projet

```
cabinet-serein/
├── server.js          ← Serveur Express + OpenAI + Twilio
├── public/
│   └── index.html     ← Interface patient + dashboard médecin
├── package.json
├── .env.example       ← Modèle de configuration
└── DEPLOY.md          ← Ce fichier
```

---

## Coûts estimés

| Service | Coût |
|---|---|
| Railway (hébergement) | ~5€/mois |
| OpenAI gpt-4o-mini | ~0.01€ par conversation |
| Twilio SMS | ~0.07€ par SMS |
| **Total pour 200 patients/mois** | **~15-20€/mois** |

Tu factures le médecin 99€/mois → **marge nette ~80€/client**

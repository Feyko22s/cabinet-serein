require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const twilio = require("twilio");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ─── État en mémoire (remplace par une DB en production) ───
let tickets = [];
let ticketCounter = 0;
const SLOTS = ["9h00","9h30","10h00","10h30","11h00","11h30","14h00","14h30","15h00","15h30","16h00","16h30","17h00"];
let slotIndex = 0;

function getNextSlot() {
  return SLOTS[slotIndex < SLOTS.length ? slotIndex++ : SLOTS.length - 1];
}

function createTicket(name, phone = null, urgent = false) {
  ticketCounter++;
  const ticket = {
    num: ticketCounter,
    name,
    phone,
    heure: urgent ? "Priorité urgence" : getNextSlot(),
    status: tickets.length === 0 ? "now" : "wait",
    urgent,
    createdAt: new Date().toISOString(),
  };
  tickets.push(ticket);
  return ticket;
}

// ─── Envoi SMS via Twilio ───
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log(`[SMS simulé → ${to}]: ${message}`);
    return;
  }
  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    console.log(`SMS envoyé à ${to}`);
  } catch (err) {
    console.error("Erreur SMS:", err.message);
  }
}

// ─── Prompt système pour l'agent IA ───
function buildSystemPrompt() {
  const waitingCount = tickets.filter((t) => t.status === "wait").length;
  const currentPatient = tickets.find((t) => t.status === "now");
  const slotsLeft = SLOTS.length - slotIndex;

  return `Tu es l'assistant vocal du ${process.env.DOCTOR_NAME || "cabinet médical"}.
Adresse : ${process.env.CABINET_ADDRESS || "cabinet médical"}
Téléphone : ${process.env.CABINET_PHONE || ""}
Horaires : ${process.env.OPENING_HOURS || "Lundi-Vendredi 9h-18h"}

État actuel :
- Patients en attente : ${waitingCount}
- Patient en consultation : ${currentPatient ? currentPatient.name : "aucun"}
- Places disponibles aujourd'hui : ${slotsLeft}

Tes règles :
1. Réponds TOUJOURS en JSON avec ce format exact :
{
  "message": "ta réponse au patient (texte naturel, chaleureux)",
  "action": "none" | "create_ticket" | "urgent" | "check_status",
  "name": "prénom du patient si détecté",
  "phone": "numéro de téléphone si mentionné (format +33...)",
  "ticket_num": null ou numéro si le patient demande son statut
}

2. Si le patient veut un ticket → action: "create_ticket"
3. Si c'est urgent (douleur forte, fièvre élevée, enfant malade) → action: "urgent"
4. Si le patient demande son tour → action: "check_status"
5. Sois chaleureux, rassurant, et concis (max 3 phrases)
6. Si plus de place → dis-le gentiment et propose de rappeler demain`;
}

// ─── Route: Chat avec l'IA ───
app.post("/api/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  try {
    const messages = [
      { role: "system", content: buildSystemPrompt() },
      ...history.slice(-6),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { message: raw, action: "none" };
    }

    let ticket = null;

    if (parsed.action === "create_ticket" || parsed.action === "urgent") {
      const name = parsed.name || "Patient";
      const urgent = parsed.action === "urgent";
      ticket = createTicket(name, parsed.phone || null, urgent);

      const smsText = urgent
        ? `Cabinet ${process.env.DOCTOR_NAME} : vous êtes en priorité urgence. Venez directement.`
        : `Cabinet ${process.env.DOCTOR_NAME} : votre ticket N°${ticket.num} est confirmé. Heure estimée : ${ticket.heure}. Nous vous préviendrons 30 min avant.`;

      if (parsed.phone) await sendSMS(parsed.phone, smsText);

      parsed.message = parsed.message.replace("{num}", ticket.num).replace("{heure}", ticket.heure);
    }

    if (parsed.action === "check_status" && parsed.ticket_num) {
      const t = tickets.find((x) => x.num == parsed.ticket_num);
      if (t) {
        const before = tickets.filter((x) => x.status === "wait" && x.num < t.num).length;
        parsed.message += ` Il y a ${before} patient(s) avant vous (environ ${before * 15} min).`;
      }
    }

    res.json({ reply: parsed.message, ticket, tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Désolé, une erreur s'est produite. Veuillez rappeler.", tickets });
  }
});

// ─── Route: Dashboard médecin ───
app.get("/api/tickets", (req, res) => {
  res.json({ tickets, stats: {
    total: tickets.length,
    waiting: tickets.filter((t) => t.status === "wait").length,
    done: tickets.filter((t) => t.status === "done").length,
    slotsLeft: SLOTS.length - slotIndex,
  }});
});

// ─── Route: Appeler le patient suivant ───
app.post("/api/tickets/:num/call", async (req, res) => {
  const t = tickets.find((x) => x.num == req.params.num);
  if (!t) return res.status(404).json({ error: "Ticket non trouvé" });

  tickets.forEach((x) => { if (x.status === "now") x.status = "done"; });
  t.status = "now";

  if (t.phone) {
    await sendSMS(t.phone, `C'est votre tour ! Le ${process.env.DOCTOR_NAME} vous attend. Cabinet : ${process.env.CABINET_ADDRESS}`);
  }

  res.json({ success: true, tickets });
});

// ─── Route: Réinitialiser la journée ───
app.post("/api/reset", (req, res) => {
  tickets = [];
  ticketCounter = 0;
  slotIndex = 0;
  res.json({ success: true });
});

// ─── Route: SMS entrant Twilio (webhook) ───
app.post("/webhook/sms", async (req, res) => {
  const { Body, From } = req.body;
  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: Body },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (parsed.action === "create_ticket" || parsed.action === "urgent") {
      const ticket = createTicket(parsed.name || "Patient", From, parsed.action === "urgent");
      twiml.message(`Cabinet ${process.env.DOCTOR_NAME} : Ticket N°${ticket.num} confirmé — ${ticket.heure}. On vous prévient avant votre tour !`);
    } else {
      twiml.message(parsed.message);
    }
  } catch {
    twiml.message("Désolé, réessayez ou appelez directement le cabinet.");
  }

  res.type("text/xml").send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Cabinet Serein démarré sur http://localhost:${PORT}`);
  console.log(`   Dashboard médecin : http://localhost:${PORT}/dashboard`);
  console.log(`   API chat : POST http://localhost:${PORT}/api/chat`);
  console.log(`   Webhook SMS : POST http://localhost:${PORT}/webhook/sms\n`);
});

const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);

// =====================================================
// PAGE WEB
// =====================================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// =====================================================
// DONNEES DU MOTEUR
// =====================================================

let moteurData = {
    rpm: 0,
    ax: 0,
    ay: 0,
    az: 0,

    accelerationRMS: 0,
    vibration: 0,

    impulsions: 0,
    impulsionsTotal: 0,

    ecart: 0,

    heure: "00:00:00",

    etat: "ARRET",
    moteur: "OFF",

    timestamp: null
};

// =====================================================
// COMMANDE
// =====================================================

let commande = "NONE";

// =====================================================
// DERNIERE ANOMALIE TELEGRAM
// =====================================================

let derniereAlerte = "";

let derniereAlerteTemps = 0;

const DELAI_ALERTE = 60000;

// =====================================================
// PAGE D'ACCUEIL API
// =====================================================

app.get("/api", (req, res) => {

    res.json({
        serveur: "Surveillance moteur",
        statut: "OK",
        message: "API opérationnelle"
    });

});

// =====================================================
// ACCUEIL
// =====================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});

// =====================================================
// ESP32 -> RENDER
// POST /api/data
// =====================================================

app.post("/api/data", (req, res) => {

    const data = req.body || {};

    moteurData = {

        rpm:
            Number(data.rpm) || 0,

        ax:
            Number(data.ax) || 0,

        ay:
            Number(data.ay) || 0,

        az:
            Number(data.az) || 0,

        accelerationRMS:
            Number(data.accelerationRMS) || 0,

        vibration:
            Number(data.vibration) || 0,

        impulsions:
            Number(data.impulsions) || 0,

        impulsionsTotal:
            Number(data.impulsionsTotal) || 0,

        ecart:
            Number(data.ecart) || 0,

        heure:
            data.heure || "00:00:00",

        etat:
            data.etat || "INCONNU",

        moteur:
            data.moteur || "OFF",

        timestamp:
            new Date().toISOString()
    };

    console.log("");
    console.log(
        "===== DONNEES RECUES ESP32 ====="
    );

    console.log(
        `RPM : ${moteurData.rpm}`
    );

    console.log(
        `AX : ${moteurData.ax}`
    );

    console.log(
        `AY : ${moteurData.ay}`
    );

    console.log(
        `AZ : ${moteurData.az}`
    );

    console.log(
        `ARMS : ${moteurData.accelerationRMS}`
    );

    console.log(
        `VRMS : ${moteurData.vibration}`
    );

    console.log(
        `IMPULSIONS : ${moteurData.impulsions}`
    );

    console.log(
        `TOTAL : ${moteurData.impulsionsTotal}`
    );

    console.log(
        `HEURE : ${moteurData.heure}`
    );

    console.log(
        `ECART : ${moteurData.ecart}`
    );

    console.log(
        `ETAT : ${moteurData.etat}`
    );

    console.log(
        `MOTEUR : ${moteurData.moteur}`
    );

    console.log(
        "================================"
    );

    // =================================================
    // ALERTE
    // =================================================

    verifierAnomalie();

    res.json({

        success: true,

        message:
            "Données reçues",

        timestamp:
            moteurData.timestamp

    });

});

// =====================================================
// APP WEB -> RENDER
// GET /api/data
// =====================================================

app.get("/api/data", (req, res) => {

    res.json(
        moteurData
    );

});

// =====================================================
// APP WEB -> RENDER
// POST /api/command
// =====================================================

app.post("/api/command", (req, res) => {

    const nouvelleCommande =
        String(
            req.body.command || ""
        ).toUpperCase();

    // -----------------------------------------------
    // START
    // -----------------------------------------------

    if (
        nouvelleCommande === "START"
    ) {

        commande = "START";

        console.log(
            "COMMANDE RECUE : START"
        );

        return res.json({

            success: true,

            command: "START",

            message:
                "Commande START enregistrée"

        });

    }

    // -----------------------------------------------
    // STOP
    // -----------------------------------------------

    if (
        nouvelleCommande === "STOP"
    ) {

        commande = "STOP";

        console.log(
            "COMMANDE RECUE : STOP"
        );

        return res.json({

            success: true,

            command: "STOP",

            message:
                "Commande STOP enregistrée"

        });

    }

    // -----------------------------------------------
    // COMMANDE INVALIDE
    // -----------------------------------------------

    return res.status(400).json({

        success: false,

        message:
            "Commande invalide. Utiliser START ou STOP."

    });

});

// =====================================================
// ESP32 -> RENDER
// GET /api/command
// =====================================================

app.get("/api/command", (req, res) => {

    const commandeEnvoyee =
        commande;

    // -----------------------------------------------
    // IMPORTANT :
    // La commande est consommée une seule fois.
    // -----------------------------------------------

    commande = "NONE";

    console.log(
        "COMMANDE ENVOYEE ESP32 :",
        commandeEnvoyee
    );

    res.json({

        command:
            commandeEnvoyee

    });

});

// =====================================================
// TELEGRAM
// =====================================================
//
// Pour l'instant le serveur fonctionne même sans
// configuration Telegram.
//
// On ajoutera ensuite les variables :
//
// TELEGRAM_BOT_TOKEN
// TELEGRAM_CHAT_ID
//
// =====================================================

async function envoyerTelegram(message) {

    const token =
        process.env.TELEGRAM_BOT_TOKEN;

    const chatId =
        process.env.TELEGRAM_CHAT_ID;

    if (
        !token ||
        !chatId
    ) {

        console.log(
            "Telegram non configure."
        );

        return;

    }

    try {

        const url =
            `https://api.telegram.org/bot${token}/sendMessage`;

        const reponse =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            chat_id:
                                chatId,

                            text:
                                message

                        })
                }
            );

        const resultat =
            await reponse.json();

        console.log(
            "Telegram :",
            resultat
        );

    }
    catch (erreur) {

        console.error(
            "Erreur Telegram :",
            erreur.message
        );

    }

}

// =====================================================
// DETECTION ANOMALIE
// =====================================================

function verifierAnomalie() {

    const vibration =
        moteurData.vibration;

    const ecart =
        moteurData.ecart;

    const etat =
        moteurData.etat;

    // -----------------------------------------------
    // Seuil vibration
    // -----------------------------------------------

    const vibrationAnormale =
        vibration >= 4.0;

    // -----------------------------------------------
    // Seuil écart RPM
    // -----------------------------------------------

    const vitesseAnormale =
        ecart >= 10.0;

    // -----------------------------------------------
    // Anomalie déclarée par UNO
    // -----------------------------------------------

    const anomalieEtat =
        etat === "ANOMALIE";

    if (
        !vibrationAnormale &&
        !vitesseAnormale &&
        !anomalieEtat
    ) {

        return;

    }

    const maintenant =
        Date.now();

    if (
        maintenant -
        derniereAlerteTemps <
        DELAI_ALERTE
    ) {

        return;

    }

    const message =

`🚨 ALERTE MOTEUR

État : ${moteurData.etat}
Moteur : ${moteurData.moteur}

RPM : ${moteurData.rpm}
AX : ${moteurData.ax}
AY : ${moteurData.ay}
AZ : ${moteurData.az}

ARMS : ${moteurData.accelerationRMS}
VRMS : ${moteurData.vibration}

Impulsions : ${moteurData.impulsions}
Total : ${moteurData.impulsionsTotal}

Écart RPM : ${moteurData.ecart} %

Heure : ${moteurData.heure}`;

    derniereAlerte =
        message;

    derniereAlerteTemps =
        maintenant;

    envoyerTelegram(
        message
    );

}

// =====================================================
// DEMARRAGE
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "===================================="
        );

        console.log(
            " SERVEUR SURVEILLANCEMOTEUR"
        );

        console.log(
            ` Port : ${PORT}`
        );

        console.log(
            "===================================="
        );

    }
);

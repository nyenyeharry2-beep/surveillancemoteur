// ============================================================
// SERVEUR IoT - SURVEILLANCE MOTEUR
// Render + PostgreSQL + ESP32 + Arduino UNO
// Dashboard + Telegram
// ============================================================

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

// ============================================================
// CONFIGURATION EXPRESS
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers du projet
app.use(express.static(__dirname));

// ============================================================
// POSTGRESQL
// ============================================================

let pool = null;

if (process.env.DATABASE_URL) {

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    console.log("DATABASE_URL détectée.");

} else {

    console.log(
        "ATTENTION : DATABASE_URL n'est pas configurée."
    );
}

// ============================================================
// DERNIERE DONNEE EN MEMOIRE
// ============================================================

let derniereDonnee = {

    success: true,

    rpm: 0,

    ax: 0,
    ay: 0,
    az: 0,

    arms: 0,
    vrms: 0,

    impulsions: 0,
    impulsionsTotal: 0,

    ecart: 0,

    heure: "00:00:00",

    etat: "ARRET",

    moteur: "OFF",

    alarme: "OFF",

    probleme: "AUCUN"

};

// ============================================================
// COMMANDES
// ============================================================

let derniereCommande = "NONE";

let numeroCommande = 0;

// ============================================================
// ETAT TELEGRAM
// ============================================================

let derniereAlarmeTelegram = false;

// ============================================================
// INITIALISATION POSTGRESQL
// ============================================================

async function initialiserBase() {

    if (!pool) {
        return;
    }

    try {

        await pool.query(`

            CREATE TABLE IF NOT EXISTS mesures (

                id SERIAL PRIMARY KEY,

                created_at TIMESTAMPTZ DEFAULT NOW(),

                rpm DOUBLE PRECISION DEFAULT 0,

                ax DOUBLE PRECISION DEFAULT 0,
                ay DOUBLE PRECISION DEFAULT 0,
                az DOUBLE PRECISION DEFAULT 0,

                arms DOUBLE PRECISION DEFAULT 0,
                vrms DOUBLE PRECISION DEFAULT 0,

                impulsions INTEGER DEFAULT 0,
                impulsions_total INTEGER DEFAULT 0,

                ecart DOUBLE PRECISION DEFAULT 0,

                heure TEXT,

                etat TEXT,

                moteur TEXT,

                alarme TEXT,

                probleme TEXT
            )

        `);

        await pool.query(`

            CREATE TABLE IF NOT EXISTS commandes (

                id SERIAL PRIMARY KEY,

                commande TEXT NOT NULL,

                created_at TIMESTAMPTZ DEFAULT NOW(),

                executee BOOLEAN DEFAULT FALSE

            )

        `);

        console.log(
            "Base PostgreSQL initialisée."
        );

    } catch (error) {

        console.error(
            "Erreur initialisation PostgreSQL :",
            error.message
        );
    }
}

// ============================================================
// TELEGRAM
// ============================================================

const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_CHAT_ID =
    process.env.TELEGRAM_CHAT_ID || "";

async function envoyerTelegram(message) {

    if (
        !TELEGRAM_BOT_TOKEN ||
        !TELEGRAM_CHAT_ID
    ) {

        console.log(
            "Telegram non configuré."
        );

        return;
    }

    try {

        const url =
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const response =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        chat_id:
                            TELEGRAM_CHAT_ID,

                        text:
                            message

                    })
                }
            );

        const resultat =
            await response.json();

        if (!resultat.ok) {

            console.error(
                "Erreur Telegram :",
                resultat
            );
        }

    } catch (error) {

        console.error(
            "Erreur connexion Telegram :",
            error.message
        );
    }
}

// ============================================================
// PAGE PRINCIPALE
// ============================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );

});

// ============================================================
// TEST SERVEUR
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({

        success: true,

        serveur:
            "surveillance-moteur",

        database:
            !!pool,

        timestamp:
            new Date().toISOString()

    });

});

// ============================================================
// GET /api/data
// ============================================================

app.get("/api/data", async (req, res) => {

    try {

        if (pool) {

            const result =
                await pool.query(`

                    SELECT

                        rpm,

                        ax,
                        ay,
                        az,

                        arms,
                        vrms,

                        impulsions,
                        impulsions_total,

                        ecart,

                        heure,

                        etat,

                        moteur,

                        alarme,

                        probleme

                    FROM mesures

                    ORDER BY id DESC

                    LIMIT 1

                `);

            if (
                result.rows.length > 0
            ) {

                const ligne =
                    result.rows[0];

                derniereDonnee = {

                    success: true,

                    rpm:
                        Number(ligne.rpm || 0),

                    ax:
                        Number(ligne.ax || 0),

                    ay:
                        Number(ligne.ay || 0),

                    az:
                        Number(ligne.az || 0),

                    arms:
                        Number(ligne.arms || 0),

                    vrms:
                        Number(ligne.vrms || 0),

                    impulsions:
                        Number(
                            ligne.impulsions || 0
                        ),

                    impulsionsTotal:
                        Number(
                            ligne.impulsions_total || 0
                        ),

                    ecart:
                        Number(ligne.ecart || 0),

                    heure:
                        ligne.heure ||
                        "00:00:00",

                    etat:
                        ligne.etat ||
                        "ARRET",

                    moteur:
                        ligne.moteur ||
                        "OFF",

                    alarme:
                        ligne.alarme ||
                        "OFF",

                    probleme:
                        ligne.probleme ||
                        "AUCUN"

                };
            }
        }

        res.json(
            derniereDonnee
        );

    } catch (error) {

        console.error(
            "GET /api/data :",
            error.message
        );

        res.json(
            derniereDonnee
        );
    }

});

// ============================================================
// POST /api/data
// ESP32 -> RENDER
// ============================================================

app.post("/api/data", async (req, res) => {

    try {

        const body =
            req.body || {};

        // ----------------------------------------------------
        // MESURES
        // ----------------------------------------------------

        const rpm =
            Number(body.rpm ?? 0);

        const ax =
            Number(body.ax ?? 0);

        const ay =
            Number(body.ay ?? 0);

        const az =
            Number(body.az ?? 0);

        const arms =
            Number(
                body.arms ??
                body.accelerationRMS ??
                0
            );

        const vrms =
            Number(
                body.vrms ??
                body.vibration ??
                0
            );

        const impulsions =
            Number(
                body.impulsions ?? 0
            );

        const impulsionsTotal =
            Number(
                body.impulsionsTotal ??
                body.impulsions_total ??
                0
            );

        const ecart =
            Number(
                body.ecart ?? 0
            );

        const heure =
            String(
                body.heure ||
                new Date().toLocaleTimeString(
                    "fr-FR",
                    {
                        hour12: false
                    }
                )
            );

        const etat =
            String(
                body.etat ||
                "ARRET"
            );

        const moteur =
            String(
                body.moteur ||
                "OFF"
            );

        const alarme =
            String(
                body.alarme ||
                "OFF"
            );

        const probleme =
            String(
                body.probleme ||
                "AUCUN"
            );

        // ----------------------------------------------------
        // PROTECTION NaN / INFINITY
        // ----------------------------------------------------

        const valeurs = [
            rpm,
            ax,
            ay,
            az,
            arms,
            vrms,
            impulsions,
            impulsionsTotal,
            ecart
        ];

        for (
            const valeur of valeurs
        ) {

            if (!Number.isFinite(valeur)) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Valeur numérique invalide"

                });
            }
        }

        // ----------------------------------------------------
        // MEMOIRE
        // ----------------------------------------------------

        derniereDonnee = {

            success: true,

            rpm,

            ax,
            ay,
            az,

            arms,
            vrms,

            impulsions,
            impulsionsTotal,

            ecart,

            heure,

            etat,

            moteur,

            alarme,

            probleme

        };

        console.log(
            "DONNEES ESP32 :",
            derniereDonnee
        );

        // ----------------------------------------------------
        // POSTGRESQL
        // ----------------------------------------------------

        if (pool) {

            await pool.query(`

                INSERT INTO mesures (

                    rpm,

                    ax,
                    ay,
                    az,

                    arms,
                    vrms,

                    impulsions,
                    impulsions_total,

                    ecart,

                    heure,

                    etat,

                    moteur,

                    alarme,

                    probleme

                )

                VALUES (

                    $1,
                    $2,
                    $3,
                    $4,

                    $5,
                    $6,

                    $7,
                    $8,

                    $9,

                    $10,

                    $11,

                    $12,

                    $13,

                    $14

                )

            `, [

                rpm,

                ax,
                ay,
                az,

                arms,
                vrms,

                impulsions,
                impulsionsTotal,

                ecart,

                heure,

                etat,

                moteur,

                alarme,

                probleme

            ]);
        }

        // ----------------------------------------------------
        // TELEGRAM
        // Seulement lors du passage OFF -> ON
        // ----------------------------------------------------

        const alarmeActuelle =
            alarme.toUpperCase() === "ON";

        if (
            alarmeActuelle &&
            !derniereAlarmeTelegram
        ) {

            const message =

                "🚨 ALARME MOTEUR\n\n" +

                "RPM : " +
                rpm.toFixed(2) +
                " tr/min\n" +

                "VRMS : " +
                vrms.toFixed(2) +
                " mm/s\n" +

                "ARMS : " +
                arms.toFixed(2) +
                " m/s²\n" +

                "Impulsions : " +
                impulsions +
                "\n\n" +

                "Problème : " +
                probleme +
                "\n\n" +

                "Heure : " +
                heure;

            await envoyerTelegram(
                message
            );
        }

        derniereAlarmeTelegram =
            alarmeActuelle;

        // ----------------------------------------------------
        // REPONSE
        // ----------------------------------------------------

        res.json({

            success: true,

            message:
                "Mesure enregistrée",

            data:
                derniereDonnee

        });

    } catch (error) {

        console.error(
            "POST /api/data :",
            error
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur enregistrement mesure",

            details:
                error.message

        });
    }

});

// ============================================================
// GET /api/history
// ============================================================

app.get("/api/history", async (req, res) => {

    try {

        if (!pool) {

            return res.json({

                success: true,

                count: 0,

                data: []

            });
        }

        let limite =
            Number(
                req.query.limit || 100
            );

        if (
            !Number.isFinite(limite)
        ) {

            limite = 100;
        }

        limite =
            Math.max(
                1,
                Math.min(
                    Math.floor(limite),
                    1000
                )
            );

        const result =
            await pool.query(`

                SELECT

                    id,

                    created_at,

                    rpm,

                    ax,
                    ay,
                    az,

                    arms,
                    vrms,

                    impulsions,
                    impulsions_total,

                    ecart,

                    heure,

                    etat,

                    moteur,

                    alarme,

                    probleme

                FROM mesures

                ORDER BY id DESC

                LIMIT $1

            `, [
                limite
            ]);

        res.json({

            success: true,

            count:
                result.rows.length,

            data:
                result.rows

        });

    } catch (error) {

        console.error(
            "GET /api/history :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur récupération historique",

            details:
                error.message

        });
    }

});

// ============================================================
// POST /api/command
// DASHBOARD -> RENDER
// ============================================================

app.post("/api/command", async (req, res) => {

    try {

        let commande =
            req.body?.command ||
            req.body?.commande;

        if (!commande) {

            return res.status(400).json({

                success: false,

                error:
                    "Commande absente"

            });
        }

        commande =
            String(commande)
                .trim()
                .toUpperCase();

        if (
            commande !== "START" &&
            commande !== "STOP"
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Commande invalide"

            });
        }

        // ----------------------------------------------------
        // NUMERO COMMANDE
        // ----------------------------------------------------

        numeroCommande++;

        derniereCommande =
            commande;

        // ----------------------------------------------------
        // POSTGRESQL
        // ----------------------------------------------------

        if (pool) {

            await pool.query(`

                INSERT INTO commandes (

                    commande,

                    executee

                )

                VALUES (

                    $1,

                    FALSE

                )

            `, [
                commande
            ]);
        }

        console.log(
            "NOUVELLE COMMANDE :",
            commande
        );

        res.json({

            success: true,

            commande,

            numeroCommande

        });

    } catch (error) {

        console.error(
            "POST /api/command :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur commande",

            details:
                error.message

        });
    }

});

// ============================================================
// GET /api/command
// ESP32 -> RENDER
// ============================================================

app.get("/api/command", async (req, res) => {

    try {

        if (pool) {

            const result =
                await pool.query(`

                    SELECT

                        id,

                        commande,

                        created_at

                    FROM commandes

                    WHERE executee = FALSE

                    ORDER BY id ASC

                    LIMIT 1

                `);

            if (
                result.rows.length > 0
            ) {

                const commande =
                    result.rows[0];

                await pool.query(`

                    UPDATE commandes

                    SET executee = TRUE

                    WHERE id = $1

                `, [
                    commande.id
                ]);

                derniereCommande =
                    commande.commande;

                res.json({

                    success: true,

                    commande:
                        commande.commande,

                    numeroCommande:
                        commande.id

                });

                return;
            }
        }

        // ----------------------------------------------------
        // AUCUNE COMMANDE
        // ----------------------------------------------------

        res.json({

            success: true,

            commande:
                "NONE",

            numeroCommande:
                0

        });

    } catch (error) {

        console.error(
            "GET /api/command :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur récupération commande",

            details:
                error.message

        });
    }

});

// ============================================================
// ROUTE 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "Route introuvable",

            route:
                req.originalUrl

        });
    }
);

// ============================================================
// DEMARRAGE
// ============================================================

async function demarrer() {

    await initialiserBase();

    app.listen(

        PORT,

        "0.0.0.0",

        () => {

            console.log();
            console.log(
                "======================================"
            );

            console.log(
                " SERVEUR SURVEILLANCE MOTEUR"
            );

            console.log(
                "======================================"
            );

            console.log(
                "PORT :",
                PORT
            );

            console.log(
                "PAGE : /"
            );

            console.log(
                "API DATA : GET/POST /api/data"
            );

            console.log(
                "HISTORIQUE : GET /api/history"
            );

            console.log(
                "COMMAND : GET/POST /api/command"
            );

            console.log(
                "DATABASE :",
                pool
                    ? "CONNECTEE"
                    : "NON CONFIGUREE"
            );

            console.log(
                "TELEGRAM :",
                TELEGRAM_BOT_TOKEN
                    ? "CONFIGURE"
                    : "NON CONFIGURE"
            );

            console.log(
                "======================================"
            );
        }
    );
}

demarrer();

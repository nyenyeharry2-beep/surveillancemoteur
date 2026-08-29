const express = require("express");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));

// =====================================================
// POSTGRESQL
// =====================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// =====================================================
// CREATION TABLE
// =====================================================

async function initialiserBase() {

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS historique_moteur (
        id SERIAL PRIMARY KEY,

        timestamp TIMESTAMPTZ DEFAULT NOW(),

        rpm REAL DEFAULT 0,

        ax REAL DEFAULT 0,
        ay REAL DEFAULT 0,
        az REAL DEFAULT 0,

        acceleration_rms REAL DEFAULT 0,
        vibration REAL DEFAULT 0,

        impulsions INTEGER DEFAULT 0,
        impulsions_total INTEGER DEFAULT 0,

        ecart REAL DEFAULT 0,

        heure VARCHAR(20),

        etat VARCHAR(30),

        moteur VARCHAR(10)
      )
    `);

    console.log("Base PostgreSQL OK");
    console.log("Table historique_moteur OK");

  } catch (error) {

    console.error(
      "Erreur PostgreSQL :",
      error.message
    );
  }
}

// =====================================================
// DERNIERE DONNEE
// =====================================================

let derniereDonnee = {

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

  timestamp: new Date().toISOString()
};

// =====================================================
// TELEGRAM
// =====================================================

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

let derniereAlerte = "";

async function envoyerTelegram(message) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {

    console.log(
      "Telegram non configure"
    );

    return;
  }

  try {

    const url =
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    await fetch(url, {

      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({

        chat_id:
          TELEGRAM_CHAT_ID,

        text: message
      })
    });

  } catch (error) {

    console.error(
      "Erreur Telegram :",
      error.message
    );
  }
}

// =====================================================
// POST /api/data
// =====================================================

app.post(
  "/api/data",
  async (req, res) => {

    try {

      const d = req.body;

      derniereDonnee = {

        rpm: Number(d.rpm) || 0,

        ax: Number(d.ax) || 0,
        ay: Number(d.ay) || 0,
        az: Number(d.az) || 0,

        accelerationRMS:
          Number(
            d.accelerationRMS
          ) || 0,

        vibration:
          Number(d.vibration) || 0,

        impulsions:
          Number(d.impulsions) || 0,

        impulsionsTotal:
          Number(
            d.impulsionsTotal
          ) || 0,

        ecart:
          Number(d.ecart) || 0,

        heure:
          d.heure || "00:00:00",

        etat:
          d.etat || "ARRET",

        moteur:
          d.moteur || "OFF",

        timestamp:
          d.timestamp ||
          new Date().toISOString()
      };

      // =================================================
      // ENREGISTREMENT POSTGRESQL
      // =================================================

      await pool.query(

        `
        INSERT INTO historique_moteur
        (
          timestamp,
          rpm,
          ax,
          ay,
          az,
          acceleration_rms,
          vibration,
          impulsions,
          impulsions_total,
          ecart,
          heure,
          etat,
          moteur
        )

        VALUES
        (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13
        )
        `,

        [

          derniereDonnee.timestamp,

          derniereDonnee.rpm,

          derniereDonnee.ax,
          derniereDonnee.ay,
          derniereDonnee.az,

          derniereDonnee.accelerationRMS,

          derniereDonnee.vibration,

          derniereDonnee.impulsions,

          derniereDonnee.impulsionsTotal,

          derniereDonnee.ecart,

          derniereDonnee.heure,

          derniereDonnee.etat,

          derniereDonnee.moteur
        ]
      );

      // =================================================
      // TELEGRAM
      // =================================================

      if (
        derniereDonnee.etat ===
        "ANOMALIE"
      ) {

        const alerte =
          `🚨 ALERTE MOTEUR

RPM : ${derniereDonnee.rpm}
Vibration : ${derniereDonnee.vibration} mm/s
Écart RPM : ${derniereDonnee.ecart} %
Heure : ${derniereDonnee.heure}
État : ANOMALIE
Moteur : ${derniereDonnee.moteur}`;

        // éviter de spammer Telegram
        if (
          alerte !== derniereAlerte
        ) {

          await envoyerTelegram(
            alerte
          );

          derniereAlerte =
            alerte;
        }

      } else {

        derniereAlerte = "";
      }

      res.json({

        success: true,

        message:
          "Données enregistrées",

        data:
          derniereDonnee
      });

    } catch (error) {

      console.error(
        "Erreur /api/data :",
        error
      );

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

// =====================================================
// GET /api/latest
// =====================================================

app.get(
  "/api/latest",
  (req, res) => {

    res.json(
      derniereDonnee
    );
  }
);

// =====================================================
// GET /api/history
// =====================================================

app.get(
  "/api/history",
  async (req, res) => {

    try {

      const limit =
        Math.min(
          Number(req.query.limit) || 100,
          1000
        );

      const result =
        await pool.query(

          `
          SELECT

            id,

            timestamp,

            rpm,

            ax,
            ay,
            az,

            acceleration_rms
              AS "accelerationRMS",

            vibration,

            impulsions,

            impulsions_total
              AS "impulsionsTotal",

            ecart,

            heure,

            etat,

            moteur

          FROM historique_moteur

          ORDER BY timestamp DESC

          LIMIT $1
          `,

          [limit]
        );

      res.json({

        success: true,

        count:
          result.rows.length,

        data:
          result.rows
      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

// =====================================================
// GET /api/history/date
// =====================================================

app.get(
  "/api/history/date",
  async (req, res) => {

    try {

      const debut =
        req.query.debut;

      const fin =
        req.query.fin;

      if (
        !debut ||
        !fin
      ) {

        return res.status(400).json({

          success: false,

          error:
            "debut et fin sont obligatoires"
        });
      }

      const result =
        await pool.query(

          `
          SELECT

            id,
            timestamp,

            rpm,

            ax,
            ay,
            az,

            acceleration_rms
              AS "accelerationRMS",

            vibration,

            impulsions,

            impulsions_total
              AS "impulsionsTotal",

            ecart,

            heure,

            etat,

            moteur

          FROM historique_moteur

          WHERE timestamp
          BETWEEN $1 AND $2

          ORDER BY timestamp ASC
          `,

          [
            debut,
            fin
          ]
        );

      res.json({

        success: true,

        count:
          result.rows.length,

        data:
          result.rows
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

// =====================================================
// GET /api/alerts
// =====================================================

app.get(
  "/api/alerts",
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT *

          FROM historique_moteur

          WHERE etat = 'ANOMALIE'

          ORDER BY timestamp DESC

          LIMIT 100

        `);

      res.json({

        success: true,

        data:
          result.rows
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

// =====================================================
// COMMANDES
// =====================================================

let commandeMoteur =
  "STOP";

app.post(
  "/api/command",
  async (req, res) => {

    const commande =
      String(
        req.body.commande || ""
      ).toUpperCase();

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

    commandeMoteur =
      commande;

    console.log(
      "Commande moteur :",
      commande
    );

    res.json({

      success: true,

      commande:
        commandeMoteur
    });
  }
);

// =====================================================
// GET COMMAND
// =====================================================

app.get(
  "/api/command",
  (req, res) => {

    res.json({

      success: true,

      commande:
        commandeMoteur
    });
  }
);

// =====================================================
// TEST
// =====================================================

app.get(
  "/api/test",
  (req, res) => {

    res.json({

      success: true,

      message:
        "Serveur surveillance moteur OK",

      database:
        "PostgreSQL",

      telegram:
        TELEGRAM_BOT_TOKEN
          ? "CONFIGURE"
          : "NON CONFIGURE"
    });
  }
);

// =====================================================
// DEMARRAGE
// =====================================================

app.listen(
  PORT,
  async () => {

    console.log(
      `Serveur lancé sur le port ${PORT}`
    );

    await initialiserBase();
  }
);

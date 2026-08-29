
const express = require("express");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Tableau de bord situé dans /public
app.use(express.static("public"));

// ============================================================
// POSTGRESQL
// ============================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }
});

// ============================================================
// DERNIERE DONNEE RECUE
// ============================================================

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

// ============================================================
// COMMANDE MOTEUR
// ============================================================

// STOP par sécurité au démarrage
let commandeEnAttente = "STOP";

let numeroCommande = 0;

let derniereCommandeEnvoyee = "STOP";


// ============================================================
// INITIALISATION BASE DE DONNEES
// ============================================================

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

    console.log(
      "PostgreSQL : table historique_moteur OK"
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
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

let derniereAlerteTelegram = "";

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

  } catch (error) {

    console.error(
      "Erreur Telegram :",
      error.message
    );

  }

}


// ============================================================
// PAGE PRINCIPALE
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      __dirname +
      "/public/index.html"
    );

  }
);


// ============================================================
// TEST SERVEUR
// ============================================================

app.get(
  "/api/test",
  async (req, res) => {

    let database = "ERREUR";

    try {

      await pool.query(
        "SELECT NOW()"
      );

      database = "OK";

    } catch (error) {

      database = "ERREUR";

    }

    res.json({

      success: true,

      serveur:
        "OK",

      database:
        database,

      telegram:
        TELEGRAM_BOT_TOKEN &&
        TELEGRAM_CHAT_ID
          ? "CONFIGURE"
          : "NON CONFIGURE",

      commande:
        commandeEnAttente

    });

  }
);


// ============================================================
// ESP32 → RENDER
// RECEPTION DES MESURES
// ============================================================

app.post(
  "/api/data",
  async (req, res) => {

    try {

      const d = req.body || {};


      // ------------------------------------------------------
      // CONVERSION DES DONNEES
      // ------------------------------------------------------

      derniereDonnee = {

        rpm:
          Number(d.rpm) || 0,

        ax:
          Number(d.ax) || 0,

        ay:
          Number(d.ay) || 0,

        az:
          Number(d.az) || 0,

        accelerationRMS:
          Number(
            d.accelerationRMS ??
            d.arms
          ) || 0,

        vibration:
          Number(
            d.vibration ??
            d.vrms
          ) || 0,

        impulsions:
          Number(
            d.impulsions
          ) || 0,

        impulsionsTotal:
          Number(
            d.impulsionsTotal
          ) || 0,

        ecart:
          Number(
            d.ecart
          ) || 0,

        heure:
          d.heure ||
          "00:00:00",

        etat:
          String(
            d.etat ||
            "ARRET"
          ).toUpperCase(),

        moteur:
          String(
            d.moteur ||
            "OFF"
          ).toUpperCase(),

        timestamp:
          d.timestamp ||
          new Date().toISOString()

      };


      // ------------------------------------------------------
      // ENREGISTREMENT HISTORIQUE
      // ------------------------------------------------------

      await pool.query(

        `

        INSERT INTO historique_moteur (

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

          $13

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


      // ------------------------------------------------------
      // ALERTE TELEGRAM
      // ------------------------------------------------------

      if (
        derniereDonnee.etat ===
        "ANOMALIE"
      ) {

        const message =

          `🚨 ALERTE MOTEUR

RPM : ${derniereDonnee.rpm.toFixed(2)}
AX : ${derniereDonnee.ax.toFixed(2)}
AY : ${derniereDonnee.ay.toFixed(2)}
AZ : ${derniereDonnee.az.toFixed(2)}

ARMS : ${derniereDonnee.accelerationRMS.toFixed(2)} m/s²
VRMS : ${derniereDonnee.vibration.toFixed(2)} mm/s

Impulsions : ${derniereDonnee.impulsions}
Impulsions totales : ${derniereDonnee.impulsionsTotal}

Ecart RPM : ${derniereDonnee.ecart.toFixed(2)} %

Heure : ${derniereDonnee.heure}

Etat : ANOMALIE
Moteur : ${derniereDonnee.moteur}`;


        if (
          message !==
          derniereAlerteTelegram
        ) {

          await envoyerTelegram(
            message
          );

          derniereAlerteTelegram =
            message;

        }

      } else {

        derniereAlerteTelegram =
          "";

      }


      // ------------------------------------------------------
      // REPONSE ESP32
      // ------------------------------------------------------

      res.json({

        success: true,

        message:
          "Donnee enregistree",

        commande:
          commandeEnAttente,

        data:
          derniereDonnee

      });


    } catch (error) {

      console.error(
        "Erreur POST /api/data :",
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


// ============================================================
// DERNIERE DONNEE
// ============================================================

app.get(
  "/api/latest",
  (req, res) => {

    res.json(
      derniereDonnee
    );

  }
);


// ============================================================
// WEB → RENDER
// NOUVELLE COMMANDE START / STOP
// ============================================================

app.post(
  "/api/command",
  (req, res) => {

    try {

      const commande =
        String(
          req.body.commande ||
          req.body.command ||
          ""
        ).toUpperCase();


      if (
        commande !== "START" &&
        commande !== "STOP"
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Commande invalide. Utiliser START ou STOP."

        });

      }


      // ------------------------------------------------------
      // ENREGISTRER LA COMMANDE
      // ------------------------------------------------------

      commandeEnAttente =
        commande;

      numeroCommande++;


      console.log(
        "================================"
      );

      console.log(
        "NOUVELLE COMMANDE :",
        commande
      );

      console.log(
        "NUMERO :",
        numeroCommande
      );

      console.log(
        "================================"
      );


      res.json({

        success: true,

        commande:
          commande,

        numeroCommande:
          numeroCommande,

        message:
          `Commande ${commande} en attente pour l'ESP32`

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


// ============================================================
// ESP32 → RENDER
// RECUPERER LA COMMANDE
// ============================================================
//
// L'ESP32 doit appeler cette URL régulièrement.
//
// Exemple :
// GET /api/command
//
// ============================================================

app.get(
  "/api/command",
  (req, res) => {

    res.json({

      success: true,

      commande:
        commandeEnAttente,

      numeroCommande:
        numeroCommande

    });

  }
);


// ============================================================
// CONFIRMATION DE COMMANDE PAR ESP32
// ============================================================
//
// Après avoir reçu et exécuté START/STOP,
// l'ESP32 peut appeler :
//
// POST /api/command/ack
//
// Body :
// {
//   "commande": "START",
//   "numeroCommande": 5
// }
//
// ============================================================

app.post(
  "/api/command/ack",
  (req, res) => {

    const commande =
      String(
        req.body.commande ||
        ""
      ).toUpperCase();

    const numero =
      Number(
        req.body.numeroCommande
      );


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


    derniereCommandeEnvoyee =
      commande;


    console.log(
      "ESP32 CONFIRME :",
      commande,
      "numero :",
      numero
    );


    res.json({

      success: true,

      message:
        "Commande confirmee",

      commande:
        commande,

      numeroCommande:
        numero

    });

  }
);


// ============================================================
// HISTORIQUE
// ============================================================

app.get(
  "/api/history",
  async (req, res) => {

    try {

      let limit =
        Number(
          req.query.limit
        ) || 100;


      // Sécurité

      if (
        limit < 1
      ) {

        limit = 100;

      }


      if (
        limit > 1000
      ) {

        limit = 1000;

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
        "Erreur historique :",
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


// ============================================================
// HISTORIQUE PAR DATE
// ============================================================

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
            "Utiliser ?debut=DATE&fin=DATE"

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


// ============================================================
// HISTORIQUE DES ANOMALIES
// ============================================================

app.get(
  "/api/alerts",
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT

            id,

            timestamp,

            rpm,

            vibration,

            ecart,

            heure,

            etat,

            moteur

          FROM historique_moteur

          WHERE etat = 'ANOMALIE'

          ORDER BY timestamp DESC

          LIMIT 100

        `);


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


// ============================================================
// STATISTIQUES
// ============================================================

app.get(
  "/api/stats",
  async (req, res) => {

    try {

      const result =
        await pool.query(`

          SELECT

            COUNT(*) AS total_mesures,

            COALESCE(
              AVG(rpm),
              0
            ) AS rpm_moyen,

            COALESCE(
              AVG(vibration),
              0
            ) AS vibration_moyenne,

            COALESCE(
              MAX(vibration),
              0
            ) AS vibration_max,

            COUNT(
              CASE
                WHEN etat = 'ANOMALIE'
                THEN 1
              END
            ) AS nombre_anomalies

          FROM historique_moteur

        `);


      res.json({

        success: true,

        data:
          result.rows[0]

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


// ============================================================
// 404
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

app.listen(
  PORT,
  async () => {

    console.log(
      "========================================"
    );

    console.log(
      "SERVEUR SURVEILLANCE MOTEUR"
    );

    console.log(
      "Port :",
      PORT
    );

    console.log(
      "========================================"
    );


    await initialiserBase();

  }
);

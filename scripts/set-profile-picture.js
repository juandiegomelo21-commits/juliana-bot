require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const ACCESS_TOKEN = process.env.ACCESS_TOKEN?.replace(/[^\x20-\x7E]/g, "").trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();

async function uploadImage(imagePath) {
  const fileBuffer = fs.readFileSync(imagePath);
  const fileSize = fileBuffer.length;
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  // Paso 1: iniciar sesión de subida
  const sessionRes = await axios.post(
    "https://graph.facebook.com/v19.0/app/uploads",
    null,
    {
      params: {
        file_length: fileSize,
        file_type: mimeType,
        access_token: ACCESS_TOKEN,
      },
    }
  );

  const uploadSessionId = sessionRes.data.id;
  console.log("Sesión de subida iniciada:", uploadSessionId);

  // Paso 2: subir los bytes de la imagen
  const uploadRes = await axios.post(
    `https://graph.facebook.com/v19.0/${uploadSessionId}`,
    fileBuffer,
    {
      headers: {
        Authorization: `OAuth ${ACCESS_TOKEN}`,
        "Content-Type": mimeType,
        file_offset: "0",
      },
    }
  );

  const handle = uploadRes.data.h;
  console.log("Imagen subida. Handle:", handle);
  return handle;
}

async function setProfilePicture(handle) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
    {
      messaging_product: "whatsapp",
      profile_picture_handle: handle,
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.error("Uso: node scripts/set-profile-picture.js <ruta-de-imagen>");
    console.error("Ejemplo: node scripts/set-profile-picture.js foto.jpg");
    process.exit(1);
  }

  const absolutePath = path.resolve(imagePath);

  if (!fs.existsSync(absolutePath)) {
    console.error("No se encontró la imagen:", absolutePath);
    process.exit(1);
  }

  console.log("Subiendo imagen:", absolutePath);
  const handle = await uploadImage(absolutePath);

  console.log("Actualizando foto de perfil...");
  await setProfilePicture(handle);

  console.log("¡Foto de perfil actualizada exitosamente!");
}

main().catch((err) => {
  console.error("Error:", err.response?.data || err.message);
  process.exit(1);
});

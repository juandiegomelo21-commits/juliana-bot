require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();
const ACCESS_TOKEN = process.env.ACCESS_TOKEN?.replace(/[^\x20-\x7E]/g, "").trim();

async function updateProfilePicture(imagePath) {
  const fileSize = fs.statSync(imagePath).size;
  console.log(`📸 Foto: ${imagePath} (${fileSize} bytes)`);

  // Paso 1: iniciar sesión de upload resumible
  const sessionRes = await axios.post(
    `https://graph.facebook.com/v19.0/app/uploads`,
    null,
    {
      params: {
        file_name: "foto.png",
        file_length: fileSize,
        file_type: "image/png",
        access_token: ACCESS_TOKEN,
      },
    }
  );
  const uploadSessionId = sessionRes.data.id;
  console.log(`✅ Sesión de upload creada: ${uploadSessionId}`);

  // Paso 2: subir el archivo binario
  const fileBuffer = fs.readFileSync(imagePath);
  const uploadRes = await axios.post(
    `https://graph.facebook.com/v19.0/${uploadSessionId}`,
    fileBuffer,
    {
      headers: {
        Authorization: `OAuth ${ACCESS_TOKEN}`,
        "Content-Type": "image/png",
        file_offset: "0",
      },
    }
  );
  const handle = uploadRes.data.h;
  console.log(`✅ Handle obtenido: ${handle}`);

  // Paso 3: asignar como foto de perfil
  const profileRes = await axios.post(
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

  console.log("🎉 Foto de perfil actualizada:", profileRes.data);
}

const imagePath = path.join(
  process.env.USERPROFILE || process.env.HOME || "/",
  "Desktop",
  "foto.png"
);

if (!fs.existsSync(imagePath)) {
  console.error(`❌ No se encontró la imagen en: ${imagePath}`);
  process.exit(1);
}

updateProfilePicture(imagePath).catch((err) => {
  console.error("❌ Error:", err.response?.data || err.message);
  process.exit(1);
});

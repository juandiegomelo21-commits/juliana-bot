require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();
const ACCESS_TOKEN = process.env.ACCESS_TOKEN?.replace(/[^\x20-\x7E]/g, "").trim();

async function updateProfilePicture(imagePath) {
  console.log(`📸 Subiendo foto: ${imagePath}`);

  // Paso 1: subir la imagen como media de WhatsApp
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/png");
  form.append("file", fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
    contentType: "image/png",
  });

  const uploadRes = await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        ...form.getHeaders(),
      },
    }
  );

  const mediaId = uploadRes.data.id;
  console.log(`✅ Imagen subida. Media ID: ${mediaId}`);

  // Paso 2: asignar esa imagen como foto de perfil del bot
  const profileRes = await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
    {
      messaging_product: "whatsapp",
      profile_picture_handle: mediaId,
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("🎉 Foto de perfil actualizada correctamente:", profileRes.data);
}

// Ruta de la imagen: Desktop/foto.png
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

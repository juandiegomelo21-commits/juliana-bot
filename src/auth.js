const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const db = require("./db");

function setupAuth(app) {
  // ── Sesión ────────────────────────────────────────────────────────
  const sessionOpts = {
    secret: process.env.SESSION_SECRET || "juliana-session-secret-2025",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
      httpOnly: true,
      sameSite: "lax",
    },
  };

  if (process.env.MONGODB_URI) {
    const MongoStore = require("connect-mongo");
    sessionOpts.store = MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions",
      ttl: 7 * 24 * 60 * 60,
    });
  }

  app.set("trust proxy", 1);
  app.use(session(sessionOpts));
  app.use(passport.initialize());
  app.use(passport.session());

  // ── Estrategia Google ─────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${baseUrl}/auth/google/callback`,
        },
        async (_at, _rt, profile, done) => {
          try {
            const googleId = profile.id;
            const email = profile.emails?.[0]?.value || null;
            const name = profile.displayName || email;
            const avatar = profile.photos?.[0]?.value || null;

            let user = await db.getUserByGoogleId(googleId);
            if (!user) {
              user = await db.createGoogleAccount({ googleId, email, name, avatar });
            } else {
              // Actualiza avatar/nombre si cambiaron
              await db.updateGoogleProfile(googleId, { name, avatar, email });
              user = { ...user, name, avatar, googleEmail: email };
            }

            return done(null, {
              userId: user.userId,
              googleId,
              email,
              name,
              avatar,
              username: user.username || null,
              messageCount: user.messageCount || 0,
              authType: "google",
            });
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  } else {
    console.warn("⚠️  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no configurados — Google Auth deshabilitado");
  }

  passport.serializeUser((user, done) => done(null, JSON.stringify(user)));
  passport.deserializeUser((data, done) => {
    try { done(null, JSON.parse(data)); }
    catch { done(null, null); }
  });
}

module.exports = { setupAuth };

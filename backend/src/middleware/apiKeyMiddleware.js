const apiKeyMiddleware = (req, res, next) => {
  // Read the key when each request arrives
  const serverApiKey = process.env.API_KEY;
  const clientApiKey = req.headers["x-api-key"];

  if (!serverApiKey) {
    console.error("API_KEY is missing from backend environment");

    return res.status(500).json({
      message: "API key is not configured on the server",
    });
  }

  if (!clientApiKey || clientApiKey !== serverApiKey) {
    return res.status(403).json({
      message: "Invalid API key. Access denied.",
    });
  }

  next();
};

export default apiKeyMiddleware;
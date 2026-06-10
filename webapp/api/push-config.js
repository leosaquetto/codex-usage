module.exports = async function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  const publicKey = process.env.VAPID_PUBLIC_KEY || null;
  return response.status(200).json({
    enabled: Boolean(publicKey && process.env.BLOB_READ_WRITE_TOKEN),
    publicKey,
  });
};

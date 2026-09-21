"use client";

const MAX_DATA_URL_LENGTH = 850000;

/**
 * Shrinks a photo taken on the phone to a JPEG data URL small enough to store with the report
 * (max 1280px on the long side, quality lowered until it fits).
 */
export async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo procesar la foto.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.72, 0.6, 0.5, 0.4, 0.3]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
  }
  throw new Error("La foto es demasiado pesada. Probá con una de menor resolución.");
}

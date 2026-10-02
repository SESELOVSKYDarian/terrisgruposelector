/** "Paso 3252" -> "Paso", "14 de Julio 4150" -> "14 de Julio": the street is everything before the door number. */
export function streetOf(address: string) {
  const match = /^(.*?)\s+\d/.exec(address.trim());
  return (match ? match[1] : address).trim();
}

/** First number after the street name, used to order the buildings of one street. */
export function houseNumber(address: string) {
  const match = /\s(\d+)/.exec(address);
  return match ? Number(match[1]) : 0;
}

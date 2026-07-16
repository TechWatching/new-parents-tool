import Tesseract from 'tesseract.js'

/**
 * Runs on-device text recognition on an image (e.g. a photo of a handwritten
 * note or a bottle/scale display) and returns the recognized text.
 */
export async function extractTextFromImage(image: Blob | File): Promise<string> {
  const { data } = await Tesseract.recognize(image, 'eng')
  return data.text
}

/**
 * Extracts the first decimal number found in a piece of text, accepting
 * both `.` and `,` as decimal separators.
 */
export function parseFirstNumber(text: string): number | null {
  const match = text.match(/\d+(?:[.,]\d+)?/)
  if (!match) return null

  const value = Number(match[0].replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

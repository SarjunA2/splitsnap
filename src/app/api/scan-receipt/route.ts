import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import convert from "heic-convert";
import type { ReceiptData } from "@/app/lib/types";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

function isHeicFile(filename: string, mimetype: string) {
  return (
    mimetype === "image/heic" || mimetype === "image/heif" ||
    filename.toLowerCase().endsWith(".heic") || filename.toLowerCase().endsWith(".heif")
  );
}

function sanitizeMediaType(raw: string): AllowedType {
  if (ALLOWED_TYPES.includes(raw as AllowedType)) return raw as AllowedType;
  return "image/jpeg";
}

export async function POST(req: NextRequest) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;

    if (!imageFile) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const rawBytes = Buffer.from(await imageFile.arrayBuffer());
    let imageBuffer: Buffer = rawBytes;
    let mediaType: AllowedType;

    if (isHeicFile(imageFile.name, imageFile.type)) {
      console.log("[scan-receipt] Converting HEIC → JPEG via heic-convert...");
      const outputBuffer = await convert({
        buffer: rawBytes,
        format: "JPEG",
        quality: 0.85,
      });
      imageBuffer = Buffer.from(outputBuffer);
      mediaType = "image/jpeg";
    } else {
      mediaType = sanitizeMediaType(imageFile.type);
    }

    console.log(
      "[scan-receipt] file:", imageFile.name,
      "| type:", imageFile.type,
      "→ sending as:", mediaType,
      "| size:", imageBuffer.length, "bytes"
    );

    const base64 = imageBuffer.toString("base64");

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `Analyze this receipt image and extract all information. Return ONLY valid JSON matching this exact schema, no markdown, no explanation:

{
  "items": [
    { "id": "item_1", "name": "Item name", "price": 12.99, "quantity": 1 }
  ],
  "subtotal": 45.00,
  "tax": 4.05,
  "tip": 0,
  "total": 49.05,
  "currency": "USD",
  "restaurantName": "Restaurant Name or null",
  "date": "2024-01-15 or null"
}

Rules:
- id must be "item_1", "item_2", etc.
- price is the per-unit price (not quantity × price)
- quantity defaults to 1 if not shown
- tax: extract actual tax amount, 0 if not present
- tip: extract tip if on receipt, 0 if not present
- total: the final total on the receipt
- subtotal: before tax and tip
- If a value is unclear, make a best estimate
- Return ONLY the JSON object`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const receiptData: ReceiptData = JSON.parse(cleaned);

    return NextResponse.json(receiptData);
  } catch (err) {
    console.error("[scan-receipt]", err);
    return NextResponse.json(
      { error: "Failed to scan receipt", details: String(err) },
      { status: 500 }
    );
  }
}

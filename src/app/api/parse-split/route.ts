import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { LineItem, Person, ItemAssignment } from "@/app/lib/types";

interface ParseSplitRequest {
  transcript: string;
  items: LineItem[];
  people: Person[];
}

export async function POST(req: NextRequest) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const body: ParseSplitRequest = await req.json();
    const { transcript, items, people } = body;

    if (!transcript || !items?.length || !people?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const itemsList = items
      .map((i) => `- id: "${i.id}", name: "${i.name}", price: $${(i.price * i.quantity).toFixed(2)}`)
      .join("\n");

    const peopleList = people.map((p) => `- id: "${p.id}", name: "${p.name}"`).join("\n");

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are parsing a voice message about splitting a restaurant bill.

RECEIPT ITEMS:
${itemsList}

PEOPLE AT THE TABLE:
${peopleList}

VOICE MESSAGE TRANSCRIPT:
"${transcript}"

Based on the voice message, assign each receipt item to one or more people. Return ONLY valid JSON, no markdown, no explanation:

{
  "assignments": [
    { "itemId": "item_1", "personIds": ["person_id_here"] },
    { "itemId": "item_2", "personIds": ["person_id_1", "person_id_2"] }
  ],
  "unassignedItemIds": ["item_3"],
  "notes": "Brief note about any ambiguities or assumptions made"
}

Rules:
- Every item must appear in either assignments or unassignedItemIds
- If an item is shared between multiple people, list all their ids in personIds
- If the voice message is ambiguous about an item, make the best reasonable guess and note it
- Match people by name (case-insensitive, partial matches are fine)
- If someone "split" or "shared" something, include all parties in personIds`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(cleaned);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[parse-split]", err);
    return NextResponse.json(
      { error: "Failed to parse split", details: String(err) },
      { status: 500 }
    );
  }
}

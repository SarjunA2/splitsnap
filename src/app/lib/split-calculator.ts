import type { ReceiptData, Person, ItemAssignment, SplitResult, PersonSplit } from "./types";

export function calculateSplit(
  receipt: ReceiptData,
  people: Person[],
  assignments: ItemAssignment[]
): SplitResult {
  const personMap = new Map(people.map((p) => [p.id, p]));

  // Build per-person subtotals
  const personSubtotals = new Map<string, number>();
  const personItemDetails = new Map<
    string,
    { name: string; price: number; share: number }[]
  >();

  people.forEach((p) => {
    personSubtotals.set(p.id, 0);
    personItemDetails.set(p.id, []);
  });

  for (const assignment of assignments) {
    const item = receipt.items.find((i) => i.id === assignment.itemId);
    if (!item || assignment.personIds.length === 0) continue;

    const sharePerPerson = (item.price * item.quantity) / assignment.personIds.length;

    for (const personId of assignment.personIds) {
      if (!personSubtotals.has(personId)) continue;
      personSubtotals.set(personId, (personSubtotals.get(personId) ?? 0) + sharePerPerson);
      personItemDetails.get(personId)?.push({
        name: item.name,
        price: item.price * item.quantity,
        share: sharePerPerson,
      });
    }
  }

  // Distribute tax + tip proportionally based on each person's subtotal
  const totalSubtotal = Array.from(personSubtotals.values()).reduce((a, b) => a + b, 0);

  const splits: PersonSplit[] = people.map((person) => {
    const sub = personSubtotals.get(person.id) ?? 0;
    const ratio = totalSubtotal > 0 ? sub / totalSubtotal : 1 / people.length;
    const taxShare = receipt.tax * ratio;
    const tipShare = receipt.tip * ratio;

    return {
      personId: person.id,
      personName: person.name,
      items: personItemDetails.get(person.id) ?? [],
      subtotal: sub,
      taxShare,
      tipShare,
      total: sub + taxShare + tipShare,
    };
  });

  return {
    splits,
    totalAccountedFor: splits.reduce((a, s) => a + s.total, 0),
    receiptTotal: receipt.total,
  };
}

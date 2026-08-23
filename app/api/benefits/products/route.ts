import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { benefitDefs, cardProducts } from "../../../../db/schema";
import { insertBenefitDef, parseBenefitsList } from "../../../../lib/benefit-defs";

const now = () => new Date().toISOString();

export async function GET() {
  try {
    const db = getDb();
    const [products, defs] = await Promise.all([
      db.select().from(cardProducts).orderBy(asc(cardProducts.name)),
      db.select().from(benefitDefs).orderBy(asc(benefitDefs.sortOrder), asc(benefitDefs.id)),
    ]);
    return Response.json({ products, defs });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load templates." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { name?: string; benefits?: unknown };
    const name = payload.name?.trim();
    if (!name) return Response.json({ error: "Template name is required." }, { status: 400 });
    const benefits = parseBenefitsList(payload.benefits);
    const db = getDb();
    const timestamp = now();
    const created = await db.insert(cardProducts).values({
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).returning({ id: cardProducts.id });
    const productId = created[0]?.id;
    if (!productId) throw new Error("Unable to create template.");

    for (const [index, benefit] of benefits.entries()) {
      await insertBenefitDef(productId, benefit, index);
    }

    const defs = await db.select().from(benefitDefs).where(eq(benefitDefs.productId, productId));
    return Response.json({ product: { id: productId, name, createdAt: timestamp, updatedAt: timestamp }, defs });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create template." },
      { status: 500 },
    );
  }
}

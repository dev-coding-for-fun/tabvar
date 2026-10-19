import path from "node:path";
import type { E2eSessionRequest } from "../../app/routes/e2e.session";
import { DISCOUNT_MANAGER_TAG } from "../../app/lib/discounts.server";

type PersonaDefinition = Pick<E2eSessionRequest, "role"> &
  Partial<Pick<E2eSessionRequest, "tags" | "disclaimerAcknowledged">>;

/**
 * Every signed-in user the e2e suite can act as. auth.setup.ts provisions each one
 * (role, tags, disclaimer state) and saves its session once per run; specs select
 * one with `test.use({ persona })` or `pageAs(persona)`.
 *
 * Add a persona here instead of mutating a shared one inside a test: personas are
 * shared by parallel workers, so their DB state must stay exactly as declared.
 */
export const personas = {
  admin: { role: "admin" },
  super: { role: "super" },
  member: { role: "member" },
  /** Signed in, but no elevated role (the default for new accounts). */
  anonymous: { role: "anonymous" },
  /** TopoBuilder app contributor: signed in with no elevated role, isolated from `anonymous`. */
  contributor: { role: "anonymous" },
  /** TopoBuilder app secondary member: signed in with member role, isolated from `member`. */
  editor: { role: "member" },
  discountManager: { role: "member", tags: [DISCOUNT_MANAGER_TAG] },
} satisfies Record<string, PersonaDefinition>;

export type SignedInPersona = keyof typeof personas;
/** `guest` is a signed-out visitor who has already dismissed the safety disclaimer. */
export type Persona = SignedInPersona | "guest";

export const signedInPersonas = Object.keys(personas) as SignedInPersona[];

export function personaEmail(persona: SignedInPersona) {
  return `${persona.toLowerCase()}@e2e.test`;
}

export function personaSessionRequest(persona: SignedInPersona): E2eSessionRequest {
  const definition: PersonaDefinition = personas[persona];
  return {
    email: personaEmail(persona),
    // user.display_name is unique, so derive it from the persona name.
    displayName: `E2E ${persona}`,
    role: definition.role,
    tags: definition.tags ?? [],
    disclaimerAcknowledged: definition.disclaimerAcknowledged ?? true,
  };
}

export function storageStatePath(persona: Persona) {
  return path.join(import.meta.dirname, "..", ".auth", `${persona}.json`);
}

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { makePublicCode, makeSlug, normalizeCode } from '../utils/codes';

export async function createPublicOrganizationCode(organizationId: string, organizationName: string) {
  const publicCode = makePublicCode(organizationName);
  await setDoc(
    doc(db, 'organizations', organizationId),
    {
      publicCode,
      slug: makeSlug(organizationName),
    },
    { merge: true },
  );
  await setDoc(doc(db, 'publicCodes', publicCode), {
    organizationId,
    organizationName,
    createdAt: serverTimestamp(),
  });
  return publicCode;
}

export async function resolveOrganizationCode(code: string) {
  const normalized = normalizeCode(code);
  const snapshot = await getDoc(doc(db, 'publicCodes', normalized));
  if (!snapshot.exists()) {
    throw new Error('No encontramos ese codigo de negocio.');
  }

  const data = snapshot.data();
  return {
    organizationId: String(data.organizationId ?? ''),
    organizationName: String(data.organizationName ?? 'Organizacion'),
    publicCode: normalized,
  };
}

export async function resolveEmployeeInvite(code: string) {
  const normalized = normalizeCode(code);
  const snapshot = await getDoc(doc(db, 'employeeInvites', normalized));
  if (!snapshot.exists()) {
    throw new Error('No encontramos ese codigo de empleado.');
  }

  const data = snapshot.data();
  return {
    inviteCode: normalized,
    organizationId: String(data.organizationId ?? ''),
    organizationName: String(data.organizationName ?? 'Organizacion'),
    employeeId: String(data.employeeId ?? ''),
    email: String(data.email ?? ''),
    used: Boolean(data.used),
  };
}

/** Fuseaux horaires IANA connus du navigateur. */
export function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Europe/Paris', 'UTC'];
  }
}

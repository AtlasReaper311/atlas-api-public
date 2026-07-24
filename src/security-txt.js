const SECURITY_PATH = "/.well-known/security.txt";
const SECURITY_TEXT = `Contact: mailto:atlas@atlas-systems.uk
Expires: 2027-07-24T23:59:59Z
Preferred-Languages: en
Canonical: https://api.atlas-systems.uk/.well-known/security.txt
`;

export function handleSecurityTxt(path) {
  if (path !== SECURITY_PATH) return null;

  return new Response(SECURITY_TEXT, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export { SECURITY_PATH, SECURITY_TEXT };

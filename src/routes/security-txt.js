const SECURITY_TEXT = `Contact: mailto:atlas@atlas-systems.uk
Expires: 2027-07-24T23:59:59Z
Preferred-Languages: en
Canonical: https://api.atlas-systems.uk/.well-known/security.txt
`;

export function handleSecurityText() {
  return new Response(SECURITY_TEXT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

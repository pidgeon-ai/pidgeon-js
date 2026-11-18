# Changelog

## 1.0.0

Rebuilt for the new Pidgeon (`/v1`); 0.x spoke the old email API.

- Pidgeon Trigger: any of message received, held, sent, delivered or
  bounced, and draft approval requested, approved or rejected; for chosen
  inboxes or the whole account. It checks the `Pidgeon-Signature` of every
  delivery, and reads the message with its clean or original text.
- Pidgeon: Message (send, reply, get, get many, search, wait), Thread (get,
  get many, update), Draft (create, optionally for approval, and send),
  Inbox (create, get, get many), Attachment (download), and Agent Request
  (verify, with Bouncer).
- The credential is a new Pidgeon API key.
- Removed with the old API: addresses (now inboxes), extracted codes and
  links in waits, idempotency keys on sends, and assigning a thread to a
  named person.

# Supporter discount management

Site admins and users with an active `supporter_prog_manager` tag can manage the
discount program at `/discount`. Site admins can assign that tag through the
existing user tag controls at `/users`; it does not grant access to other admin
pages. Expired manager tags no longer grant discount management access.

Managers can view assigned and available QR codes, unassign codes, delete
unassigned codes, and add super supporters by email. The email form grants the
existing `super_supporter_2026` tag:

- Existing users receive the tag immediately.
- Existing invites receive the tag without changing their role or other tags.
- New email addresses get a member invite with the tag, applied when they sign in.
- Active tags are left unchanged and reported as already added. Expired supporter
  tags are renewed without an expiration date.

Email addresses are trimmed and normalized to lowercase, and user lookup is case
insensitive. The form reports success, already-added information, or an error
through notifications. If a write fails, retrying reuses any user or invite
already present. Creating an invite records it in the database; it does not send
an email. Discount codes are claimed through the existing `/discount` page flow.

Migration `0069_add_supporter_program_manager_tag.sql` adds the manager tag
definition. It grants no permissions until a site admin assigns the tag.

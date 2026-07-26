/**
 * Resolves raw email addresses to the people behind them, so the isEmailList
 * widget in nD_DynamicSection can render names and photos instead of a wall of
 * comma-separated text (AVB_Collaborators__c, AVB_Followers__c).
 *
 * Three outcomes per address, and all three have to look deliberate:
 *   - User    : internal staff. Standard-licence Users win outright, so staff
 *               read as staff even when a Contact exists for the same address.
 *   - Contact : customer side. Carries the Account name as its subtitle. Beaten
 *               only by a Standard User, which is why community and portal Users
 *               are matched last: those people are customers, and their Contact
 *               is the more useful record to show and link to.
 *   - neither : shared and role mailboxes (servicedesk@, occ.operations@) mostly
 *               exist nowhere in Salesforce. Returned with resolved = false and
 *               initials derived from the address so they still render as people.
 *
 * Photos: User.SmallPhotoUrl always returns a URL, but the default avatar is
 * /profilephoto/005/T where the segment is an object key prefix rather than a
 * real photo Id. Only genuine photos are returned; callers fall back to initials.
 * Contact.PhotoUrl is deliberately not used: it always resolves to the generic
 * silhouette endpoint and cannot be told apart from a real social photo, and a
 * silhouette carries less information than initials.
 */
public with sharing class ND_EmailResolver {

    // Long Text Area caps the field at 32768 chars; this caps the query instead.
    private static final Integer MAX_EMAILS = 200;
    private static final String PHOTO_MARKER = '/profilephoto/';

    public class ResolvedEmail {
        @AuraEnabled public String email;
        @AuraEnabled public String name;
        @AuraEnabled public String recordId;
        @AuraEnabled public String objectType;
        @AuraEnabled public String subtitle;
        @AuraEnabled public String photoUrl;
        @AuraEnabled public String initials;
        @AuraEnabled public Boolean resolved;
    }

    /**
     * @param emails raw addresses, in the order they should come back
     * @return one entry per unique address, caller order preserved
     */
    @AuraEnabled(cacheable=true)
    public static List<ResolvedEmail> resolveEmails(List<String> emails) {
        List<ResolvedEmail> results = new List<ResolvedEmail>();
        List<String> ordered = normalize(emails);
        if (ordered.isEmpty()) {
            return results;
        }

        Map<String, ResolvedEmail> byEmail = new Map<String, ResolvedEmail>();
        List<User> externalUsers = new List<User>();

        for (User u : [
            SELECT Id, Name, Email, SmallPhotoUrl, UserType
            FROM User
            WHERE Email IN :ordered AND IsActive = true
            WITH SECURITY_ENFORCED
            LIMIT 200
        ]) {
            if (u.UserType != 'Standard') {
                // A community or portal user is a customer. Give their Contact a
                // chance to win before falling back to the User record.
                externalUsers.add(u);
                continue;
            }
            String key = u.Email.toLowerCase();
            if (byEmail.containsKey(key)) {
                continue;
            }
            byEmail.put(key, forUser(u, 'Internal user'));
        }

        for (Contact c : [
            SELECT Id, Name, Email, Account.Name
            FROM Contact
            WHERE Email IN :ordered
            WITH SECURITY_ENFORCED
            LIMIT 200
        ]) {
            String key = c.Email.toLowerCase();
            if (byEmail.containsKey(key)) {
                continue;
            }
            ResolvedEmail r = new ResolvedEmail();
            r.email = c.Email;
            r.name = c.Name;
            r.recordId = c.Id;
            r.objectType = 'Contact';
            r.subtitle = (c.Account != null && String.isNotBlank(c.Account.Name))
                ? c.Account.Name
                : 'Contact';
            r.photoUrl = null;
            r.initials = initialsFor(c.Name, c.Email);
            r.resolved = true;
            byEmail.put(key, r);
        }

        // Only now, for community users with no Contact of their own
        for (User u : externalUsers) {
            String key = u.Email.toLowerCase();
            if (byEmail.containsKey(key)) {
                continue;
            }
            byEmail.put(key, forUser(u, 'Community user'));
        }

        for (String email : ordered) {
            ResolvedEmail r = byEmail.get(email.toLowerCase());
            if (r == null) {
                r = new ResolvedEmail();
                r.email = email;
                r.name = email;
                r.objectType = null;
                r.subtitle = null;
                r.photoUrl = null;
                r.initials = initialsFor(null, email);
                r.resolved = false;
            }
            results.add(r);
        }
        return results;
    }

    private static ResolvedEmail forUser(User u, String subtitle) {
        ResolvedEmail r = new ResolvedEmail();
        r.email = u.Email;
        r.name = u.Name;
        r.recordId = u.Id;
        r.objectType = 'User';
        r.subtitle = subtitle;
        r.photoUrl = realPhotoOrNull(u.SmallPhotoUrl);
        r.initials = initialsFor(u.Name, u.Email);
        r.resolved = true;
        return r;
    }

    /** Trims, drops blanks, de-dupes case-insensitively, keeps order, caps size. */
    private static List<String> normalize(List<String> emails) {
        List<String> ordered = new List<String>();
        if (emails == null) {
            return ordered;
        }
        Set<String> seen = new Set<String>();
        for (String raw : emails) {
            if (String.isBlank(raw)) {
                continue;
            }
            String email = raw.trim();
            String key = email.toLowerCase();
            if (seen.contains(key)) {
                continue;
            }
            seen.add(key);
            ordered.add(email);
            if (ordered.size() == MAX_EMAILS) {
                break;
            }
        }
        return ordered;
    }

    /** Null unless the URL carries a real photo Id rather than a key prefix. */
    @TestVisible
    private static String realPhotoOrNull(String url) {
        if (String.isBlank(url)) {
            return null;
        }
        Integer marker = url.indexOf(PHOTO_MARKER);
        if (marker < 0) {
            return null;
        }
        String tail = url.substring(marker + PHOTO_MARKER.length());
        Integer slash = tail.indexOf('/');
        String idPart = slash < 0 ? tail : tail.substring(0, slash);
        return idPart.length() >= 15 ? url : null;
    }

    /**
     * Two letters. From the display name when there is one, otherwise from the
     * address local part split on the usual separators. Tokens that don't start
     * with a letter are skipped, so "157196 Roijens" gives RO rather than 1R.
     */
    @TestVisible
    private static String initialsFor(String name, String email) {
        List<String> tokens = new List<String>();

        if (String.isNotBlank(name) && !name.contains('@')) {
            for (String part : name.trim().split('\\s+')) {
                if (startsWithLetter(part)) {
                    tokens.add(part);
                }
            }
        }
        if (tokens.isEmpty() && String.isNotBlank(email)) {
            String local = email.contains('@') ? email.substringBefore('@') : email;
            for (String part : local.split('[._\\-+]')) {
                if (startsWithLetter(part)) {
                    tokens.add(part);
                }
            }
        }
        if (tokens.isEmpty()) {
            return '?';
        }
        if (tokens.size() == 1) {
            String only = tokens[0];
            String initials = only.length() >= 2 ? only.substring(0, 2) : only.substring(0, 1);
            return initials.toUpperCase();
        }
        return (tokens[0].substring(0, 1) + tokens[tokens.size() - 1].substring(0, 1)).toUpperCase();
    }

    private static Boolean startsWithLetter(String value) {
        return String.isNotBlank(value) && Pattern.matches('(?i)^[a-z].*', value);
    }
}

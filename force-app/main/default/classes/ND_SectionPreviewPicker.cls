/**
 * Record lookups for the Section Config Builder's live preview.
 *
 * The builder previews the real nD_DynamicSection against a real record, which used to
 * mean pasting an 18-character Id by hand. This supplies the two friendlier routes:
 * a list of records the running user recently looked at, and resolving something short
 * they already know (a case number) into an Id.
 *
 * Both methods take an object API name because the builder is not Case-only, and both
 * validate it against the global describe before it reaches a query.
 */
public with sharing class ND_SectionPreviewPicker {

    private static final Integer RECENT_LIMIT = 25;

    public class RecordOption {
        @AuraEnabled public String id;
        @AuraEnabled public String label;
        @AuraEnabled public String sublabel;
    }

    /**
     * Records the running user viewed most recently, newest first.
     *
     * LastViewedDate is populated per user, so this is genuinely "mine" rather than
     * "whatever changed in the org". A user who has viewed nothing yet falls back to the
     * most recently modified records, otherwise a fresh user gets an empty picker and no
     * way forward.
     */
    @AuraEnabled(cacheable=true)
    public static List<RecordOption> getRecentRecords(String objectApiName) {
        Schema.DescribeSObjectResult describe = describeOrThrow(objectApiName);
        String fieldList = labelFieldsFor(describe);

        List<SObject> records = queryRecent(describe.getName(), fieldList, true);
        if (records.isEmpty()) {
            records = queryRecent(describe.getName(), fieldList, false);
        }
        return toOptions(records, describe);
    }

    /**
     * Turn whatever the user typed into a record Id.
     *
     * Accepts a 15 or 18 character Id, or the record's human identifier — a case number
     * for Case, the Name for anything else. Returns null when nothing matches, so the
     * caller can say so rather than previewing the wrong record.
     */
    @AuraEnabled(cacheable=true)
    public static String resolveRecordId(String objectApiName, String term) {
        if (String.isBlank(term)) return null;

        Schema.DescribeSObjectResult describe = describeOrThrow(objectApiName);
        String needle = term.trim();

        // Already an Id, and of the right type
        if (needle.length() == 15 || needle.length() == 18) {
            try {
                Id candidate = Id.valueOf(needle);
                if (candidate.getSobjectType() == describe.getSObjectType()) {
                    return String.valueOf(candidate);
                }
            } catch (Exception ignored) {
                // Not an Id after all — fall through to the identifier lookup
            }
        }

        String identifier = identifierFieldFor(describe);
        if (identifier == null) return null;

        String soql = 'SELECT Id FROM ' + describe.getName()
            + ' WHERE ' + identifier + ' = :needle'
            + ' WITH SECURITY_ENFORCED LIMIT 1';
        List<SObject> found = Database.query(soql);
        if (!found.isEmpty()) return String.valueOf(found[0].Id);

        // Case numbers are stored zero-padded ("00012024"), so a user typing the digits
        // they see elsewhere would otherwise never match.
        if (identifier == 'CaseNumber' && needle.isNumeric()) {
            String pattern = '%' + needle;
            String fuzzy = 'SELECT Id FROM ' + describe.getName()
                + ' WHERE ' + identifier + ' LIKE :pattern'
                + ' WITH SECURITY_ENFORCED ORDER BY CreatedDate DESC LIMIT 1';
            List<SObject> padded = Database.query(fuzzy);
            if (!padded.isEmpty()) return String.valueOf(padded[0].Id);
        }

        return null;
    }

    // --- internals ----------------------------------------------------------------

    private static List<SObject> queryRecent(String objectName, String fieldList, Boolean viewedOnly) {
        // Clause order matters: WITH SECURITY_ENFORCED has to sit between WHERE and
        // ORDER BY, otherwise the parser rejects it with "unexpected token: 'WITH'".
        String soql = 'SELECT ' + fieldList + ' FROM ' + objectName;
        if (viewedOnly) soql += ' WHERE LastViewedDate != NULL';
        soql += ' WITH SECURITY_ENFORCED';
        soql += viewedOnly ? ' ORDER BY LastViewedDate DESC' : ' ORDER BY LastModifiedDate DESC';
        soql += ' LIMIT ' + RECENT_LIMIT;
        return Database.query(soql);
    }

    private static Schema.DescribeSObjectResult describeOrThrow(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            throw new AuraHandledException('No object was supplied.');
        }
        // Whitelisting against the describe is what keeps the dynamic SOQL below safe
        Schema.SObjectType token = Schema.getGlobalDescribe().get(objectApiName);
        if (token == null) {
            throw new AuraHandledException('Unknown object: ' + objectApiName);
        }
        return token.getDescribe();
    }

    /** The field that identifies a record to a human, if the object has one. */
    private static String identifierFieldFor(Schema.DescribeSObjectResult describe) {
        Map<String, Schema.SObjectField> fields = describe.fields.getMap();
        if (fields.containsKey('casenumber')) return 'CaseNumber';
        if (fields.containsKey('name')) return 'Name';
        return null;
    }

    private static String labelFieldsFor(Schema.DescribeSObjectResult describe) {
        Map<String, Schema.SObjectField> fields = describe.fields.getMap();
        List<String> selected = new List<String>{ 'Id' };

        if (fields.containsKey('casenumber')) selected.add('CaseNumber');
        else if (fields.containsKey('name')) selected.add('Name');

        if (fields.containsKey('subject')) selected.add('Subject');
        return String.join(selected, ', ');
    }

    private static List<RecordOption> toOptions(
        List<SObject> records,
        Schema.DescribeSObjectResult describe
    ) {
        Map<String, Schema.SObjectField> fields = describe.fields.getMap();
        Boolean hasCaseNumber = fields.containsKey('casenumber');
        Boolean hasName = fields.containsKey('name');
        Boolean hasSubject = fields.containsKey('subject');

        List<RecordOption> options = new List<RecordOption>();
        for (SObject record : records) {
            RecordOption option = new RecordOption();
            option.id = String.valueOf(record.get('Id'));

            if (hasCaseNumber) option.label = String.valueOf(record.get('CaseNumber'));
            else if (hasName) option.label = String.valueOf(record.get('Name'));
            else option.label = option.id;

            if (hasSubject) {
                Object subject = record.get('Subject');
                option.sublabel = subject == null ? '' : String.valueOf(subject);
            } else {
                option.sublabel = '';
            }
            options.add(option);
        }
        return options;
    }
}

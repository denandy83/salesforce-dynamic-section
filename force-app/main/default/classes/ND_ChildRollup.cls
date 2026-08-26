public with sharing class ND_ChildRollup {
    /**
     * Reads ONE field off every child record on the other side of a child relationship,
     * for the `childRollup` row type in nD_DynamicSection. Returns the raw values in
     * record order; splitting, de-duplicating and filtering happen in the component, in
     * `rollupValues()` in nD_sectionConfigSchema, so that logic stays pure and Jest-testable.
     *
     * A formula field cannot do this — cross-object formulas only traverse child → parent —
     * and a roll-up summary only offers COUNT / SUM / MIN / MAX, so a text concatenation
     * needs either stored automation or a read like this one. This is the read.
     *
     * The object and field names put into the query are taken from the DESCRIBE, never from
     * the caller's strings: `relationshipName` is matched against the parent's child
     * relationships and everything after that comes from the matched describe. So the only
     * value that reaches the query from outside is `parentId`, and that goes through a bind.
     */
    @AuraEnabled(cacheable=true)
    public static List<String> getChildValues(Id parentId, String relationshipName, String fieldName) {
        List<String> values = new List<String>();
        if (parentId == null || String.isBlank(relationshipName) || String.isBlank(fieldName)) {
            return values;
        }

        Schema.DescribeSObjectResult parent = parentId.getSObjectType().getDescribe();

        Schema.ChildRelationship rel = null;
        for (Schema.ChildRelationship candidate : parent.getChildRelationships()) {
            String name = candidate.getRelationshipName();
            if (name != null && name.equalsIgnoreCase(relationshipName)) {
                rel = candidate;
                break;
            }
        }
        if (rel == null) {
            throw new AuraHandledException(
                'No child relationship named "' + relationshipName + '" on ' + parent.getName() + '.'
            );
        }

        Schema.DescribeSObjectResult child = rel.getChildSObject().getDescribe();
        // Not an error worth surfacing: an agent without read on the child object should see
        // an empty row, not a page error. Same for the field below.
        if (!child.isAccessible()) {
            return values;
        }

        // Matched by iterating rather than by getMap().get(), because a map lookup would
        // depend on the key casing the describe happens to use.
        Schema.DescribeFieldResult valueField = null;
        Schema.DescribeFieldResult nameField = null;
        for (Schema.SObjectField f : child.fields.getMap().values()) {
            Schema.DescribeFieldResult d = f.getDescribe();
            if (d.getName().equalsIgnoreCase(fieldName)) {
                valueField = d;
            }
            if (d.isNameField()) {
                nameField = d;
            }
        }
        if (valueField == null) {
            throw new AuraHandledException(
                'Field "' + fieldName + '" does not exist on ' + child.getName() + '.'
            );
        }
        if (!valueField.isAccessible()) {
            return values;
        }

        String valueApi = valueField.getName();
        String childApi = child.getName();
        String parentApi = rel.getField().getDescribe().getName();
        // A stable order so the same case reads the same way twice. The name field is the
        // useful one where there is one (the Jira key, for instance); Id is the fallback.
        String orderApi = (nameField == null) ? 'Id' : nameField.getName();

        // WITH SECURITY_ENFORCED has to sit between WHERE and ORDER BY, or the parser throws
        // at runtime only.
        String soql =
            'SELECT ' + valueApi +
            ' FROM ' + childApi +
            ' WHERE ' + parentApi + ' = :parentId' +
            ' WITH SECURITY_ENFORCED' +
            ' ORDER BY ' + orderApi +
            ' LIMIT 500';

        for (SObject row : Database.query(soql)) {
            Object raw = row.get(valueApi);
            if (raw == null) {
                continue;
            }
            String text = String.valueOf(raw);
            if (String.isNotBlank(text)) {
                values.add(text);
            }
        }
        return values;
    }
}

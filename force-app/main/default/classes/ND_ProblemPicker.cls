public with sharing class ND_ProblemPicker {
    /**
     * Returns open "Problem" Cases for the isOpenProblem lookup picker in
     * nD_DynamicSection. Matches on Subject OR CaseNumber so the user can search
     * by either. recordTypeName / excludedStatuses are passed from the LWC so the
     * business rule lives in one place (the component constants).
     */
    @AuraEnabled(cacheable=true)
    public static List<Case> getOpenProblems(
        String searchTerm,
        String recordTypeDeveloperName,
        List<String> excludedStatuses
    ) {
        String term = String.isBlank(searchTerm) ? '' : searchTerm;
        String likeTerm = '%' + term + '%';
        List<String> excluded = (excludedStatuses == null)
            ? new List<String>()
            : excludedStatuses;

        // Both the record-type and status constraints are optional so the client
        // can drop them (via the modal's filter chips) to reach any Case. User
        // input is always passed through bind variables, never concatenated.
        String soql = 'SELECT Id, CaseNumber, Subject, Status FROM Case';
        soql += ' WHERE (Subject LIKE :likeTerm OR CaseNumber LIKE :likeTerm)';
        if (String.isNotBlank(recordTypeDeveloperName)) {
            soql += ' AND RecordType.DeveloperName = :recordTypeDeveloperName';
        }
        if (!excluded.isEmpty()) {
            soql += ' AND Status NOT IN :excluded';
        }
        soql += ' WITH SECURITY_ENFORCED ORDER BY CaseNumber DESC LIMIT 200';

        return Database.query(soql);
    }
}

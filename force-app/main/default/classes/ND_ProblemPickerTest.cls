@isTest
private class ND_ProblemPickerTest {
    // Creates a Case and queries back its own record-type developer name, so the
    // test is self-contained whether or not the org has Case record types.
    @isTest
    static void returnsMatchingOpenCase() {
        Case c = new Case(Subject = 'Alpha widget failure', Status = 'New');
        insert c;

        Case inserted = [SELECT RecordType.DeveloperName FROM Case WHERE Id = :c.Id];
        String rtDev = inserted.RecordType.DeveloperName; // null when the org has no Case record types

        Test.startTest();
        List<Case> bySubject = ND_ProblemPicker.getOpenProblems(
            'Alpha', rtDev, new List<String>{ 'Closed', 'Merged' }
        );
        List<Case> byNumber = ND_ProblemPicker.getOpenProblems(
            c.CaseNumber, rtDev, new List<String>{ 'Closed', 'Merged' }
        );
        Test.stopTest();

        System.assertEquals(1, bySubject.size(), 'Open case should match on subject');
        System.assertEquals(c.Id, bySubject[0].Id, 'Returned the inserted case');
        System.assertEquals(1, byNumber.size(), 'Open case should match on case number');
    }

    @isTest
    static void excludesClosedStatuses() {
        Case c = new Case(Subject = 'Beta closed problem', Status = 'New');
        insert c;
        Case inserted = [SELECT RecordType.DeveloperName FROM Case WHERE Id = :c.Id];
        String rtDev = inserted.RecordType.DeveloperName;

        // Exclude the case's own status -> it must not come back
        List<Case> results = ND_ProblemPicker.getOpenProblems('Beta', rtDev, new List<String>{ 'New' });
        System.assertEquals(0, results.size(), 'A case whose status is excluded is filtered out');
    }

    @isTest
    static void handlesBlankAndNullArgs() {
        List<Case> results = ND_ProblemPicker.getOpenProblems(null, 'AVB_Problem_Case', null);
        System.assertNotEquals(null, results, 'Method tolerates null search term and status list');
    }

    @isTest
    static void droppingFiltersWidensResults() {
        // A closed case of the org's default record type
        Case c = new Case(Subject = 'Gamma any-type case', Status = 'New');
        insert c;

        Test.startTest();
        // No record-type filter and no status exclusions -> matches on search only
        List<Case> results = ND_ProblemPicker.getOpenProblems('Gamma', null, new List<String>());
        Test.stopTest();

        System.assertEquals(1, results.size(), 'With filters dropped the case is reachable regardless of type/status');
        System.assertEquals(c.Id, results[0].Id, 'Returned the inserted case');
    }
}

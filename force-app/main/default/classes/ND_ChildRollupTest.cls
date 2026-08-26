@isTest
private class ND_ChildRollupTest {
    // Self-contained: creates its own parent Case and child Jira Tickets, so it does not
    // depend on any org data. AVB_Case__c is the master-detail to Case and is required.
    private static Case makeCaseWithTickets(List<String> fixVersions) {
        Case parent = new Case(Subject = 'Rollup parent', Status = 'New');
        insert parent;

        List<AVB_Jira_Ticket__c> tickets = new List<AVB_Jira_Ticket__c>();
        Integer i = 0;
        for (String v : fixVersions) {
            i++;
            tickets.add(new AVB_Jira_Ticket__c(
                Name = 'AVIO-' + String.valueOf(10000 + i),
                AVB_Case__c = parent.Id,
                AVB_Fix_Versions__c = v
            ));
        }
        if (!tickets.isEmpty()) {
            insert tickets;
        }
        return parent;
    }

    @isTest
    static void returnsOneValuePerChild() {
        Case parent = makeCaseWithTickets(new List<String>{ '26.3-iOS', '27.1-iOS' });

        Test.startTest();
        List<String> values = ND_ChildRollup.getChildValues(
            parent.Id, 'Jira_Tickets__r', 'AVB_Fix_Versions__c'
        );
        Test.stopTest();

        System.assertEquals(2, values.size(), 'One entry per child ticket');
        System.assert(values.contains('26.3-iOS'), 'Returned the first ticket value');
        System.assert(values.contains('27.1-iOS'), 'Returned the second ticket value');
    }

    @isTest
    static void keepsMultiValueStringsIntact() {
        // A single ticket already holds a comma-separated list; splitting is the client's job,
        // so the raw string must come back whole.
        Case parent = makeCaseWithTickets(
            new List<String>{ '3.2.0-connect-x-service, 3.2.0-connect-x-app' }
        );

        Test.startTest();
        List<String> values = ND_ChildRollup.getChildValues(
            parent.Id, 'Jira_Tickets__r', 'AVB_Fix_Versions__c'
        );
        Test.stopTest();

        System.assertEquals(1, values.size(), 'One child, one entry');
        System.assertEquals(
            '3.2.0-connect-x-service, 3.2.0-connect-x-app',
            values[0],
            'The stored string is returned unsplit'
        );
    }

    @isTest
    static void skipsBlankAndNullValues() {
        Case parent = new Case(Subject = 'Rollup blanks', Status = 'New');
        insert parent;
        insert new List<AVB_Jira_Ticket__c>{
            new AVB_Jira_Ticket__c(Name = 'AVIO-1', AVB_Case__c = parent.Id, AVB_Fix_Versions__c = '26.3-iOS'),
            new AVB_Jira_Ticket__c(Name = 'AVIO-2', AVB_Case__c = parent.Id, AVB_Fix_Versions__c = null),
            new AVB_Jira_Ticket__c(Name = 'AVIO-3', AVB_Case__c = parent.Id, AVB_Fix_Versions__c = '   ')
        };

        Test.startTest();
        List<String> values = ND_ChildRollup.getChildValues(
            parent.Id, 'Jira_Tickets__r', 'AVB_Fix_Versions__c'
        );
        Test.stopTest();

        System.assertEquals(1, values.size(), 'Null and whitespace-only children are dropped');
        System.assertEquals('26.3-iOS', values[0], 'Only the populated value survives');
    }

    @isTest
    static void returnsEmptyWhenNoChildren() {
        Case parent = makeCaseWithTickets(new List<String>());

        Test.startTest();
        List<String> values = ND_ChildRollup.getChildValues(
            parent.Id, 'Jira_Tickets__r', 'AVB_Fix_Versions__c'
        );
        Test.stopTest();

        System.assertEquals(0, values.size(), 'A parent with no children rolls up to nothing');
    }

    @isTest
    static void handlesBlankAndNullArgs() {
        Case parent = makeCaseWithTickets(new List<String>{ '26.3-iOS' });

        Test.startTest();
        List<String> noId = ND_ChildRollup.getChildValues(null, 'Jira_Tickets__r', 'AVB_Fix_Versions__c');
        List<String> noRel = ND_ChildRollup.getChildValues(parent.Id, '', 'AVB_Fix_Versions__c');
        List<String> noField = ND_ChildRollup.getChildValues(parent.Id, 'Jira_Tickets__r', null);
        Test.stopTest();

        System.assertEquals(0, noId.size(), 'No parent Id returns empty rather than throwing');
        System.assertEquals(0, noRel.size(), 'Blank relationship returns empty');
        System.assertEquals(0, noField.size(), 'Blank field returns empty');
    }

    @isTest
    static void relationshipNameIsCaseInsensitive() {
        Case parent = makeCaseWithTickets(new List<String>{ '26.3-iOS' });

        Test.startTest();
        List<String> values = ND_ChildRollup.getChildValues(
            parent.Id, 'jira_tickets__r', 'avb_fix_versions__c'
        );
        Test.stopTest();

        System.assertEquals(1, values.size(), 'Relationship and field names match case-insensitively');
    }

    @isTest
    static void unknownRelationshipThrows() {
        Case parent = makeCaseWithTickets(new List<String>{ '26.3-iOS' });

        Test.startTest();
        Boolean threw = false;
        try {
            ND_ChildRollup.getChildValues(parent.Id, 'Not_A_Relationship__r', 'AVB_Fix_Versions__c');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A misconfigured relationship name is reported, not silently empty');
    }

    @isTest
    static void unknownFieldThrows() {
        Case parent = makeCaseWithTickets(new List<String>{ '26.3-iOS' });

        Test.startTest();
        Boolean threw = false;
        try {
            ND_ChildRollup.getChildValues(parent.Id, 'Jira_Tickets__r', 'Not_A_Field__c');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A misconfigured field name is reported, not silently empty');
    }
}

@isTest
private class ND_SectionPreviewPickerTest {

    private static Case makeCase(String subject) {
        Case c = new Case(Subject = subject, Status = 'New');
        insert c;
        return c;
    }

    @isTest
    static void returnsRecentCasesWithNumberAndSubject() {
        Case c = makeCase('Preview me');

        Test.startTest();
        List<ND_SectionPreviewPicker.RecordOption> options =
            ND_SectionPreviewPicker.getRecentRecords('Case');
        Test.stopTest();

        System.assert(!options.isEmpty(), 'Expected at least the case just inserted');

        Boolean found = false;
        for (ND_SectionPreviewPicker.RecordOption option : options) {
            if (option.id == c.Id) {
                found = true;
                System.assertEquals('Preview me', option.sublabel, 'Subject should be the sublabel');
                System.assert(String.isNotBlank(option.label), 'Case number should be the label');
            }
        }
        System.assert(found, 'The inserted case should be among the recent records');
    }

    // A brand new user has viewed nothing, so the recent list must fall back to recently
    // modified rather than coming back empty with no way forward.
    @isTest
    static void fallsBackToRecentlyModifiedWhenNothingViewed() {
        makeCase('Never viewed');

        Test.startTest();
        List<ND_SectionPreviewPicker.RecordOption> options =
            ND_SectionPreviewPicker.getRecentRecords('Case');
        Test.stopTest();

        System.assertEquals(1, options.size(), 'The fallback should still return the case');
    }

    @isTest
    static void resolvesAnIdStraightThrough() {
        Case c = makeCase('By Id');

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Case', String.valueOf(c.Id));
        Test.stopTest();

        System.assertEquals(String.valueOf(c.Id), resolved);
    }

    @isTest
    static void resolvesTheFullCaseNumber() {
        Case c = makeCase('By number');
        Case reloaded = [SELECT CaseNumber FROM Case WHERE Id = :c.Id];

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Case', reloaded.CaseNumber);
        Test.stopTest();

        System.assertEquals(String.valueOf(c.Id), resolved);
    }

    // Case numbers are stored zero-padded, so digits typed as seen elsewhere have to
    // match the padded value too.
    @isTest
    static void resolvesCaseNumberDigitsWithoutLeadingZeros() {
        Case c = makeCase('Unpadded number');
        Case reloaded = [SELECT CaseNumber FROM Case WHERE Id = :c.Id];
        String trimmed = reloaded.CaseNumber.replaceFirst('^0+', '');

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Case', trimmed);
        Test.stopTest();

        System.assertEquals(String.valueOf(c.Id), resolved, 'Digits alone should resolve');
    }

    @isTest
    static void returnsNullForSomethingThatMatchesNothing() {
        makeCase('Irrelevant');

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Case', 'no-such-case-99999999');
        Test.stopTest();

        System.assertEquals(null, resolved);
    }

    @isTest
    static void returnsNullForBlankInput() {
        System.assertEquals(null, ND_SectionPreviewPicker.resolveRecordId('Case', '   '));
        System.assertEquals(null, ND_SectionPreviewPicker.resolveRecordId('Case', null));
    }

    // An Id of the wrong object must not be accepted just because it is 18 characters
    @isTest
    static void rejectsAnIdBelongingToAnotherObject() {
        Account a = new Account(Name = 'Wrong object');
        insert a;

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Case', String.valueOf(a.Id));
        Test.stopTest();

        System.assertEquals(null, resolved, 'An Account Id is not a Case');
    }

    @isTest
    static void resolvesByNameOnAnObjectWithoutCaseNumber() {
        Account a = new Account(Name = 'Findable Account');
        insert a;

        Test.startTest();
        String resolved = ND_SectionPreviewPicker.resolveRecordId('Account', 'Findable Account');
        Test.stopTest();

        System.assertEquals(String.valueOf(a.Id), resolved);
    }

    @isTest
    static void rejectsAnUnknownObject() {
        Boolean threw = false;
        try {
            ND_SectionPreviewPicker.getRecentRecords('NotAnObject__x');
        } catch (Exception e) {
            threw = true;
        }
        System.assert(threw, 'An unknown object name must be refused, not queried');
    }

    @isTest
    static void rejectsABlankObject() {
        Boolean threw = false;
        try {
            ND_SectionPreviewPicker.resolveRecordId('', 'anything');
        } catch (Exception e) {
            threw = true;
        }
        System.assert(threw, 'A blank object name must be refused');
    }
}

/**
 * Self-contained. Uses the running user for the User branch (creating a User
 * needs a spare licence, which a test can't rely on) and its own Account +
 * Contact for the Contact branch.
 */
@IsTest
private class ND_EmailResolverTest {

    private static final String UNKNOWN_EMAIL = 'occ.operations@example.invalid';

    @TestSetup
    static void setup() {
        Account a = new Account(Name = 'Berjaya Wings');
        insert a;
        insert new Contact(
            FirstName = 'Manish',
            LastName = 'Sharma',
            Email = 'manish.sharma@example.invalid',
            AccountId = a.Id
        );
    }

    @IsTest
    static void resolvesContactWithAccountName() {
        Test.startTest();
        List<ND_EmailResolver.ResolvedEmail> results =
            ND_EmailResolver.resolveEmails(new List<String>{ 'manish.sharma@example.invalid' });
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'One address in, one entry out');
        ND_EmailResolver.ResolvedEmail r = results[0];
        Assert.isTrue(r.resolved, 'Contact should resolve');
        Assert.areEqual('Contact', r.objectType, 'Should match a Contact');
        Assert.areEqual('Manish Sharma', r.name, 'Should carry the Contact name');
        Assert.areEqual('Berjaya Wings', r.subtitle, 'Subtitle should be the Account name');
        Assert.areEqual('MS', r.initials, 'Initials come from the name');
        Assert.isNotNull(r.recordId, 'Resolved entries link to their record');
    }

    @IsTest
    static void resolvesRunningUserAsInternal() {
        User me = [SELECT Id, Name, Email FROM User WHERE Id = :UserInfo.getUserId()];

        Test.startTest();
        List<ND_EmailResolver.ResolvedEmail> results =
            ND_EmailResolver.resolveEmails(new List<String>{ me.Email });
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'One address in, one entry out');
        Assert.areEqual('User', results[0].objectType, 'Own address should match the User');
        Assert.areEqual(me.Id, results[0].recordId, 'Should link to the User record');
        Assert.areEqual('Internal user', results[0].subtitle, 'Users get the internal subtitle');
    }

    @IsTest
    static void unresolvedAddressStillRendersAsAPerson() {
        Test.startTest();
        List<ND_EmailResolver.ResolvedEmail> results =
            ND_EmailResolver.resolveEmails(new List<String>{ UNKNOWN_EMAIL });
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'Unresolved addresses are still returned');
        ND_EmailResolver.ResolvedEmail r = results[0];
        Assert.isFalse(r.resolved, 'Nothing to match');
        Assert.isNull(r.objectType, 'No object type when unmatched');
        Assert.isNull(r.recordId, 'No record to link to');
        Assert.areEqual(UNKNOWN_EMAIL, r.name, 'Falls back to the raw address');
        Assert.areEqual('OO', r.initials, 'Initials derived from occ.operations');
    }

    @IsTest
    static void preservesOrderAndDropsDuplicatesAndBlanks() {
        Test.startTest();
        List<ND_EmailResolver.ResolvedEmail> results = ND_EmailResolver.resolveEmails(
            new List<String>{
                UNKNOWN_EMAIL,
                '  ',
                null,
                'MANISH.SHARMA@example.invalid',
                'manish.sharma@example.invalid',
                '  fos@example.invalid  '
            }
        );
        Test.stopTest();

        Assert.areEqual(3, results.size(), 'Blanks dropped, duplicate folded case-insensitively');
        Assert.areEqual(UNKNOWN_EMAIL, results[0].email, 'Caller order preserved');
        Assert.areEqual('Contact', results[1].objectType, 'Uppercase address still matches');
        Assert.areEqual('fos@example.invalid', results[2].email, 'Surrounding whitespace trimmed');
    }

    @IsTest
    static void handlesEmptyAndNullInput() {
        Test.startTest();
        Assert.areEqual(0, ND_EmailResolver.resolveEmails(null).size(), 'Null in, empty out');
        Assert.areEqual(
            0,
            ND_EmailResolver.resolveEmails(new List<String>()).size(),
            'Empty in, empty out'
        );
        Assert.areEqual(
            0,
            ND_EmailResolver.resolveEmails(new List<String>{ '', '   ' }).size(),
            'All blank in, empty out'
        );
        Test.stopTest();
    }

    @IsTest
    static void keepsOnlyRealPhotoUrls() {
        String host = 'https://example.file.force.com';
        Assert.isNull(
            ND_EmailResolver.realPhotoOrNull(host + '/profilephoto/005/T'),
            'Key prefix means the default avatar'
        );
        Assert.areEqual(
            host + '/profilephoto/729TX000002bn2D/T',
            ND_EmailResolver.realPhotoOrNull(host + '/profilephoto/729TX000002bn2D/T'),
            'A real photo Id is kept'
        );
        Assert.isNull(ND_EmailResolver.realPhotoOrNull(null), 'Null is not a photo');
        Assert.isNull(ND_EmailResolver.realPhotoOrNull('/services/images/photo/003KB0'), 'Wrong endpoint');
    }

    @IsTest
    static void derivesInitialsFromAwkwardInput() {
        Assert.areEqual('RO', ND_EmailResolver.initialsFor('157196 Roijens', null), 'Numeric token skipped');
        Assert.areEqual('SR', ND_EmailResolver.initialsFor('Siemen Raets', null), 'First and last name');
        Assert.areEqual(
            'SR',
            ND_EmailResolver.initialsFor('Siemen Van Der Raets', null),
            'Middle names ignored, first and last used'
        );
        // Two tokens, so first + last initial, same rule as a first and last name
        Assert.areEqual('DF', ND_EmailResolver.initialsFor(null, 'dl-fops@example.invalid'), 'Hyphen splits');
        Assert.areEqual('SE', ND_EmailResolver.initialsFor(null, 'servicedesk@example.invalid'), 'Single token');
        Assert.areEqual('?', ND_EmailResolver.initialsFor(null, '123@example.invalid'), 'No letters at all');
        Assert.areEqual(
            'MS',
            ND_EmailResolver.initialsFor('m.sharma@example.invalid', 'm.sharma@example.invalid'),
            'A name that is really an address falls through to the local part'
        );
    }
}

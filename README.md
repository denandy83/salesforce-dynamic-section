# ND Dynamic Section

**Component Type:** Salesforce Lightning Web Component (LWC)  
**Scope:** Record Pages (Lightning App Builder)  
**Latest Feature Set:** Dynamic Header Colors, Smart Titles, Multi-Value Logic, Conditional Formatting, Grid Layouts, Validation Handling.

## 1. App Builder Configuration
These properties are configured in the right-hand sidebar when editing a Lightning Page.

| Property | Description | Example Value |
| :--- | :--- | :--- |
| **Title** | The text header. Supports Smart Fields (see Section 4). | `Warnings ({Warning_Count__c})` |
| **Icon Name** | SLDS Icon to display. | `utility:warning` |
| **Header Background** | Default hex color for the title bar. | `#005FB2` |
| **Header Text Color** | Hex color for the title text. | `#FFFFFF` |
| **Collapse by Default** | If checked, the section loads closed. | `False` |
| **Layout** | **(New)** Choose the grid layout style. | `2 Columns` or `1 Column` |
| **Field JSON Config** | The script defining the fields (See Section 2). | `[JSON String]` |
| **Trigger Field** | API Name of the field that triggers a header color change. | `Status` |
| **Trigger Value** | Value(s) that trigger the change. Supports lists. | `Working, Escalated` |
| **Active Color** | The color the header switches to when triggered. | `#D8000C` |

## 2. JSON Configuration Guide
The **Field JSON Configuration** property controls the body content. It accepts a JSON Array of Objects.

### Supported Keys

| Key | Type | Description |
| :--- | :--- | :--- |
| `apiName` | String | **Required.** The API Name of the field to display. |
| `label` | String | Optional. Overrides the standard Salesforce field label. |
| `editable` | Boolean | `true` allows inline editing. Default is `false` (Read-Only). |
| `colSpan` | Number | **(New)** Set to `2` to make the field span full width (in 2-col layout). |
| `showIfField` | String | API Name of the field to check for visibility. |
| `showIfValue` | String | The value `showIfField` must match to make this visible. |
| `color` | String | Hex code or name (e.g., "red") for the left-border alert strip. |
| `colorIfField` | String | API Name of the field to check to trigger the color. |
| `colorIfValue` | String | The value `colorIfField` must match to apply the color. |

### Configuration Examples

**A. Basic Field (Read-Only)**

    [
      { "apiName": "Description" }
    ]

**B. Editable Field with Custom Label**

    [
      { 
        "apiName": "Next_Steps__c", 
        "label": "Technician Notes", 
        "editable": true 
      }
    ]

**C. Layout Control (Full Width)**
In a "2 Columns" layout, force the Description to take up the whole row.

    [
      { "apiName": "Subject", "editable": true },
      { "apiName": "Description", "editable": true, "colSpan": 2 }
    ]

**D. Conditional Visibility (Hide/Show)**
Only show "Reason" if "Status" is "Lost".

    [
      {
        "apiName": "Loss_Reason__c",
        "showIfField": "Status",
        "showIfValue": "Lost"
      }
    ]

**E. Conditional Alert Strip**
Show a yellow strip ONLY if "Priority" is "High".

    [
      {
        "apiName": "Due_Date__c",
        "color": "#FFCC00",
        "colorIfField": "Priority",
        "colorIfValue": "High"
      }
    ]

**F. The "Phantom Field" (For Title Data)**
Use this to load data for the Title (e.g., a count) without showing the field in the list.

    [
      {
        "apiName": "Warning_Count__c",
        "//": "Check the field (to load data) but match a value that never happens (to hide it)",
        "showIfField": "Warning_Count__c",
        "showIfValue": "HIDE_ME_PLEASE"
      }
    ]

**G. Real AvioBook Use Case**
Use this to load multiple custom warning fields with red alerts.

    [
      {
        "apiName": "AVB_Warn_First_Response__c",
        "label": "First Response",
        "color": "red",
        "colorIfField": "AVB_Warn_First_Response__c"
      },
      {
        "apiName": "AVB_Warn_Analysis_Timeline__c",
        "label": "Analysis & Timeline",
        "color": "red",
        "colorIfField": "AVB_Warn_Analysis_Timeline__c"
      },
      {
        "apiName": "AVB_Warn_Customer_Escalation__c",
        "label": "Customer Escalated",
        "color": "red",
        "colorIfField": "AVB_Warn_Customer_Escalation__c"
      },
      {
        "apiName": "Warning_Count__c",
        "label": "warns",
        "showIfField": "Warning_Count__c",
        "showIfValue": "HIDE_ME_PLEASE"
      }
    ]

## 3. Dynamic Header Logic
The header background can change color based on record data.

* **Scenario A: Boolean / Checkbox Logic**
    * *Turn Red if "Is_Escalated__c" is Checked.*
    * **Trigger Field:** `Is_Escalated__c`
    * **Trigger Value:** (Leave Empty)
    * **Active Color:** `#D8000C`

* **Scenario B: Single Value Match**
    * *Turn Red if "Status" is exactly "Working".*
    * **Trigger Field:** `Status`
    * **Trigger Value:** `Working`
    * **Active Color:** `#D8000C`

* **Scenario C: Multi-Value Match**
    * *Turn Red if "Status" is "Working" OR "Escalated" OR "High Priority".*
    * **Trigger Field:** `Status`
    * **Trigger Value:** `Working, Escalated, High Priority`
    * **Active Color:** `#D8000C`

## 4. Smart Title Logic
You can inject field values directly into the Section Title.

* **Syntax:** Use curly braces `{API_Name}` inside the Title property.
* **Requirement:** The field used in the title must be loaded by the component. You must include it in your JSON configuration (either as a visible field or a "Phantom Field" per Example F above).
* **Example:**
    * **App Builder Title:** `Risk Analysis ({Warning_Count__c} Warnings)`
    * **Field JSON:** Includes `{"apiName": "Warning_Count__c" ...}`
    * **Result on Page:** `Risk Analysis (5 Warnings)`

## 5. Troubleshooting

* **Issue:** Title shows `()` instead of `(5)`.
    * **Fix:** Ensure `Warning_Count__c` is present in your Field JSON. If you don't want to see it in the list, use the "Phantom Field" configuration (Example F).
    * **Fix:** Ensure the field API name in the Title `{Curly_Braces}` matches the JSON exactly.

* **Issue:** Header color won't change.
    * **Fix:** Check for typos in the "Trigger Field" API Name.
    * **Fix:** Ensure "Trigger Value" does not contain curly braces. It should be raw text (e.g., `Working`).

* **Issue:** Error "Priority cannot be High..." when saving.
    * **Fix:** Validation Rules appear at the very top of the section in a red box. If you cannot save, scroll up to the top of the card to read the specific error message.
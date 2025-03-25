export const PERMISSION_ERROR = "You do not have the required permissions to access this page.";

export const YDS_GRADES = ['5.0', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8', '5.9', '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b'];
export const ICE_GRADES = ['WI1', 'WI2', 'WI3', 'WI4', 'WI5', 'WI6', 'WI7'];
export const BOULDER_GRADES = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16'];
export const MIXEDICE_GRADES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16'];
export const AID_GRADES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
export const CLIMB_STYLES = ['Sport', 'Trad', 'Boulder', 'Mixed Rock', 'Mixed Ice', 'Ice', 'Aid'];

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function getGradesbyStyle(style: string): string[] {
    switch (style) {
        case 'Sport':
            return YDS_GRADES;
        case 'Boulder':
            return BOULDER_GRADES;
        case 'Mixed Ice':
            return MIXEDICE_GRADES;
        case 'Mixed Rock':
            return YDS_GRADES;
        case 'Trad':
            return YDS_GRADES;
        case 'Ice':
            return ICE_GRADES;
        case 'Aid':
            return AID_GRADES;
        default:
            return YDS_GRADES;
    }
}

export function getLabelFromValue<T extends { value: string, label: string }[]>(items: T, valueToFind: string): string {
    const foundItem = items.find(item => item.value === valueToFind);
    return foundItem ? foundItem.label : valueToFind;
}

export function getGradeColor(grade: string | null): string {
    if (!grade) return 'var(--mantine-color-yellow-5)';
    
    const numericGrade = parseFloat(grade.replace('5.', ''));
    
    if (numericGrade <= 10.4) return 'var(--mantine-color-green-6)';    // 5.0-5.10d
    if (numericGrade <= 11.4) return 'var(--mantine-color-blue-7)';     // 5.11a-5.11d
    if (numericGrade <= 12.4) return 'var(--mantine-color-dark-7)';     // 5.12a-5.12d
    if (numericGrade > 12.4) return 'var(--mantine-color-red-7)';     // 5.13a+
    return 'var(--mantine-color-yellow-5)';                             // everything else
}

export type IssueType = typeof issueTypes[number]['value'];
export type SubIssueType = typeof subIssues[number]['value'];
export type RolesType = typeof userRoles[number]['value'];

export type StatusType = 'In Moderation' | 'Reported' | "Viewed" | "Completed" | "Archived";


export const issueTypes = [
    { value: 'Bolts', label: 'Bolts (#)' },
    { value: 'All Bolts', label: 'All Bolts' },
    { value: 'Anchor', label: 'Anchor' },
    { value: 'Rock', label: 'Rock' },
] as const;

export const subIssues = [
    { value: 'Loose nut', label: 'Loose nut' },
    { value: 'Loose bolt', label: 'Loose bolt' },
    { value: 'Loose glue-in', label: 'Loose glue-in' },
    { value: 'Rusted', label: 'Rusted' },
    { value: 'Outdated', label: 'Outdated' },
    { value: 'Worn', label: 'Worn' },
    { value: 'Missing (bolt and hanger)', label: 'Missing (bolt and hanger)' },
    { value: 'Missing (hanger)', label: 'Missing (hanger)' },
    { value: 'Loose block', label: 'Loose block' },
    { value: 'Loose flake', label: 'Loose flake' },
    { value: 'Other', label: 'Other' },
] as const;

export const subIssuesByType: Record<IssueType, SubIssueType[]> = {
    Bolts: ['Loose nut', 'Loose bolt', 'Loose glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    'All Bolts': ['Loose nut', 'Loose bolt', 'Loose glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    Anchor: ['Loose nut', 'Loose bolt', 'Loose glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    Rock: ['Loose block', 'Loose flake', 'Other'],
} as const;

export const userRoles = [
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
] as const;


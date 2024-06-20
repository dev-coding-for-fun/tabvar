export const PERMISSION_ERROR = "You do not have the required permissions to access this page.";


export const issueTypes = [
    { value: 'Bolts', label: 'Bolts (#)' },
    { value: 'All Bolts', label: 'All Bolts' },
    { value: 'Anchor', label: 'Anchor' },
    { value: 'Rock', label: 'Rock' },
];

export function getLabelFromValue<T extends { value: string, label: string }[]>(items: T, valueToFind: string): string {
    const foundItem = items.find(item => item.value === valueToFind);
    return foundItem ? foundItem.label : valueToFind;
}

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
];

export const subIssuesByType = {
    Bolts: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    'All Bolts': ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    Anchor: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    Rock: ['Loose block', 'Loose flake', 'Other'],
}

export const userRoles = [
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
];
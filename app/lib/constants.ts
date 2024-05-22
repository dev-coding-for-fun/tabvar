export const issueTypes = [
    { value: 'bolts', label: 'Bolts (#)' },
    { value: 'allBolts', label: 'All Bolts' },
    { value: 'anchor', label: 'Anchor' },
    { value: 'rock', label: 'Rock' },
];

export const subIssues = [
    { value: 'Loose nut', label: 'Loose nut' },
    { value: 'Loose bolt', label: 'Loose bolt' },
    { value: 'Loose Glue-in', label: 'Loose Glue-in' },
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
    bolts: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    allBolts: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    anchor: ['Loose nut', 'Loose bolt', 'Loose Glue-in', 'Rusted', 'Outdated', 'Worn', 'Missing (bolt and hanger)', 'Missing (hanger)', 'Other'],
    rock: ['Loose block', 'Loose flake', 'Other'],
}
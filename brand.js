// One place for the product name, so a rename never touches the rest of the code.
module.exports = {
  name: 'Sangriva',
  tagline: 'Your digital collection, unified',
  // folder name used by older versions (before the rename); an existing catalog there is kept and reused
  legacyDataDir: 'hdd-organizer',
  // GitHub "owner/repo" whose Releases are checked for updates. Leave empty until the project is published.
  releaseRepo: '',
  backupFormat: 'hddorg-backup' // unchanged so backups from older versions still restore
};

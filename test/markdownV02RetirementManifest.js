'use strict';

// These suites encode the retired v0.2 shared editable-DOM/list-ownership
// contract. They remain in the repository and are runnable through
// `npm run test:markdown-v02-legacy`, but they are not compatibility gates for
// the v0.3 SourceSnapshot/EditablePosition architecture.
//
// Every entry names active replacement coverage. The retirement test verifies
// both sides of each mapping so this boundary cannot silently hide a deleted
// test or an absent replacement.
const markdownV02RetirementManifest = Object.freeze([
  {
    file: 'markdownAstEditing.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownConformanceRepairs.test.js',
    replacements: [
      'markdownConformance.test.js',
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownDeletionFiller.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditablePositionCertification.test.js'
    ]
  },
  {
    file: 'markdownEditHistoryPolicy.test.js',
    replacements: [
      'markdownExplicitTransactionHistory.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownFullTraceRepair.test.js',
    replacements: [
      'markdownConformance.test.js',
      'markdownEditablePositionCertification.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownIndentation.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownIndentationUi.test.js',
    replacements: [
      'markdownEditableLiveController.test.js',
      'markdownEditablePositionCertification.test.js'
    ]
  },
  {
    file: 'markdownListEditingExpandedSourceOracle.test.js',
    replacements: [
      'markdownConformance.test.js',
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownListEmptyLifecycle.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownListHistoryRound3.test.js',
    replacements: [
      'markdownExplicitTransactionHistory.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownListLayout.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditablePositionCertification.test.js',
      'markdownEditableProjection.test.js'
    ]
  },
  {
    file: 'markdownListRound3DirectRegressions.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownNewlineSemantics.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownPage.test.js',
    replacements: [
      'markdownEditableLiveController.test.js',
      'markdownEditablePositionCertification.test.js',
      'markdownEditableProjection.test.js'
    ]
  },
  {
    file: 'markdownPageUi.test.js',
    replacements: [
      'markdownEditableLiveController.test.js',
      'markdownEditableProjection.test.js'
    ]
  },
  {
    file: 'markdownPairAndDeletionAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditablePositionCertification.test.js'
    ]
  },
  {
    file: 'markdownPhysicalIndentationAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownPhysicalLineEditing.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditablePositionCertification.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownRound2ListAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownRound2NonListAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditablePositionCertification.test.js'
    ]
  },
  {
    file: 'markdownRound3StructuralAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownRound4StructuralAuthority.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js'
    ]
  },
  {
    file: 'markdownStructuralActionTraceRepairs.test.js',
    replacements: [
      'markdownEditableFoundation.test.js',
      'markdownEditableTransactionCertification.test.js',
      'markdownExplicitTransactionHistory.test.js'
    ]
  },
  {
    file: 'markdownStructuralConformanceRegression.test.js',
    replacements: [
      'markdownEditableLiveController.test.js',
      'markdownEditableProjection.test.js',
      'markdownEditableSyntaxAdapters.test.js'
    ]
  },
  {
    file: 'markdownStructuralLayout.test.js',
    replacements: [
      'markdownEditablePositionCertification.test.js',
      'markdownEditableProjection.test.js',
      'markdownEditableSyntaxAdapters.test.js'
    ]
  }
].map((entry) => Object.freeze({
  file: entry.file,
  replacements: Object.freeze([...entry.replacements])
})));

module.exports = { markdownV02RetirementManifest };

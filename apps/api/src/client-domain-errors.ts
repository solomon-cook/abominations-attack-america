/** Domain conflicts that may be returned to clients as a 4xx response. */
export const additionalClientDomainErrors = new Set([
  "The room changed before this action was committed. Refresh and try again.",
]);

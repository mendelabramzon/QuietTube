import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        // This prototype needs no native messaging or browsing-data access.
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}

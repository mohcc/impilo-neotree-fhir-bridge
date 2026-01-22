/**
 * Test script to verify OpenCR accepts Patient resources with address fields
 * 
 * Usage:
 *   npx tsx scripts/test-address-push.ts
 * 
 * This will send a test Patient resource with address fields to OpenCR
 * and check if it's accepted.
 */

import { loadConfig } from "../src/config/index.js";
import { OpenHimClient } from "../src/openhim/client.js";

async function testAddressPush() {
  const config = loadConfig();
  const client = new OpenHimClient(config);

  // Create a test Patient resource with address fields
  const testPatient = {
    resourceType: "Patient",
    identifier: [
      {
        system: "urn:test:patient-id",
        value: `test-address-${Date.now()}`
      }
    ],
    name: [
      {
        use: "official",
        family: "Test",
        given: ["Address"]
      }
    ],
    gender: "male",
    birthDate: "1990-01-01",
    address: [
      {
        use: "home",
        type: "both",
        line: ["123 Test Street", "Test Area"],
        city: "Harare",
        district: "Harare Central",
        state: "Harare",
        postalCode: "0000",
        country: "ZW"
      }
    ],
    meta: {
      tag: [
        {
          system: "http://openclientregistry.org/fhir/clientid",
          code: config.facilityId || config.sourceId || "test"
        }
      ]
    }
  };

  console.log("🧪 Testing Patient resource with address fields...");
  console.log("📋 Patient resource:", JSON.stringify(testPatient, null, 2));
  console.log("📤 Sending to:", `${config.openhim.baseUrl}${config.openhim.channelPath}/Patient`);

  try {
    const result = await client.postResource(
      `${config.openhim.channelPath}/Patient`,
      testPatient
    );

    console.log("\n✅ Response Status:", result.status);
    console.log("📥 Response Body:", JSON.stringify(result.body, null, 2));

    if (result.status >= 200 && result.status < 300) {
      console.log("\n✅ SUCCESS: OpenCR accepted Patient resource with address fields!");
      console.log("💡 Address fields are supported by OpenCR");
    } else if (result.status === 400 || result.status === 422) {
      console.log("\n⚠️  VALIDATION ERROR: OpenCR rejected the Patient resource");
      console.log("💡 Check the response body for specific validation errors");
      console.log("💡 Address fields might not be supported or have validation issues");
    } else {
      console.log("\n❌ ERROR: Unexpected response status");
    }
  } catch (error) {
    console.error("\n❌ ERROR sending Patient resource:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Stack:", error.stack);
    }
  }
}

void testAddressPush();

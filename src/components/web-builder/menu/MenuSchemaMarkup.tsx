import { useMemo } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { LiveMenuItem } from "@/hooks/useLiveMenuItems";

interface MenuSchemaMarkupProps {
  restaurantName: string;
  menuItems: LiveMenuItem[];
  currency?: string;
}

interface MenuItemSchema {
  "@type": "MenuItem";
  name: string;
  description?: string;
  offers: {
    "@type": "Offer";
    price: number;
    priceCurrency: string;
    availability: string;
  };
  image?: string;
  suitableForDiet?: string[];
  nutrition?: {
    "@type": "NutritionInformation";
    [key: string]: string | number;
  };
}

interface MenuSectionSchema {
  "@type": "MenuSection";
  name: string;
  hasMenuItem: MenuItemSchema[];
}

interface MenuSchema {
  "@context": "https://schema.org";
  "@type": "Menu";
  name: string;
  hasMenuSection: MenuSectionSchema[];
}

export function MenuSchemaMarkup({
  restaurantName,
  menuItems,
  currency = "USD",
}: MenuSchemaMarkupProps) {
  const schemaData = useMemo(() => {
    // Group items by category
    const groupedItems = menuItems.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, LiveMenuItem[]>);

    // Map dietary tags to schema.org diet types
    const dietMap: Record<string, string> = {
      vegetarian: "https://schema.org/VegetarianDiet",
      vegan: "https://schema.org/VeganDiet",
      "gluten-free": "https://schema.org/GlutenFreeDiet",
      halal: "https://schema.org/HalalDiet",
      kosher: "https://schema.org/KosherDiet",
      "low-calorie": "https://schema.org/LowCalorieDiet",
      "low-fat": "https://schema.org/LowFatDiet",
      "low-sodium": "https://schema.org/LowSaltDiet",
    };

    // Build menu sections
    const menuSections: MenuSectionSchema[] = Object.entries(groupedItems).map(
      ([category, items]) => ({
        "@type": "MenuSection",
        name: category.charAt(0).toUpperCase() + category.slice(1),
        hasMenuItem: items.map((item): MenuItemSchema => {
          const primaryPrice =
            item.selling_price ||
            item.full_price ||
            item.half_price ||
            item.quarter_price;

          const menuItemSchema: MenuItemSchema = {
            "@type": "MenuItem",
            name: item.name,
            offers: {
              "@type": "Offer",
              price: primaryPrice,
              priceCurrency: currency,
              availability: item.is_available
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            },
          };

          // Add optional fields
          if (item.description) {
            menuItemSchema.description = item.description;
          }

          if (item.image_url) {
            menuItemSchema.image = toCdnUrl(item.image_url);
          }

          // Add dietary information
          if (item.dietary_tags && item.dietary_tags.length > 0) {
            menuItemSchema.suitableForDiet = item.dietary_tags
              .map((tag) => dietMap[tag.toLowerCase()])
              .filter(Boolean);
          }

          // Add nutritional information
          if (
            item.nutritional_info &&
            Object.keys(item.nutritional_info).length > 0
          ) {
            menuItemSchema.nutrition = {
              "@type": "NutritionInformation",
              ...Object.entries(item.nutritional_info).reduce(
                (acc, [key, value]) => {
                  // Convert keys to schema.org format (camelCase)
                  const schemaKey = key
                    .split(/[-_]/)
                    .map((word, i) =>
                      i === 0
                        ? word.toLowerCase()
                        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    )
                    .join("");
                  acc[schemaKey] = value as string | number;
                  return acc;
                },
                {} as Record<string, string | number>
              ),
            };
          }

          return menuItemSchema;
        }),
      })
    );

    const schema: MenuSchema = {
      "@context": "https://schema.org",
      "@type": "Menu",
      name: `${restaurantName} Menu`,
      hasMenuSection: menuSections,
    };

    return schema;
  }, [restaurantName, menuItems, currency]);

  // Only render if there are menu items
  if (menuItems.length === 0) {
    return null;
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData, null, 2) }}
    />
  );
}

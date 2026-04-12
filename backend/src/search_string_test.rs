use super::*;

#[test]
fn test_basic_parsing() {
    let ss = SearchString::parse("to:me from:joe@acme.com foobar");
    assert_eq!(ss.conditions.len(), 2);
    assert_eq!(ss.conditions[0], Condition { keyword: "to".to_string(), value: "me".to_string(), negated: false });
    assert_eq!(ss.conditions[1], Condition { keyword: "from".to_string(), value: "joe@acme.com".to_string(), negated: false });
    assert_eq!(ss.text_segments.len(), 1);
    assert_eq!(ss.text_segments[0], TextSegment { text: "foobar".to_string(), negated: false });
}

#[test]
fn test_negation() {
    let ss = SearchString::parse("-to:me -foobar");
    assert_eq!(ss.conditions.len(), 1);
    assert_eq!(ss.conditions[0], Condition { keyword: "to".to_string(), value: "me".to_string(), negated: true });
    assert_eq!(ss.text_segments.len(), 1);
    assert_eq!(ss.text_segments[0], TextSegment { text: "foobar".to_string(), negated: true });
}

#[test]
fn test_quoted_values() {
    let ss = SearchString::parse("title:\"my bug\" description:'some text' \"just text\"");
    assert_eq!(ss.conditions.len(), 2);
    assert_eq!(ss.conditions[0], Condition { keyword: "title".to_string(), value: "my bug".to_string(), negated: false });
    assert_eq!(ss.conditions[1], Condition { keyword: "description".to_string(), value: "some text".to_string(), negated: false });
    assert_eq!(ss.text_segments.len(), 1);
    assert_eq!(ss.text_segments[0], TextSegment { text: "just text".to_string(), negated: false });
}

#[test]
fn test_comma_separated() {
    let ss = SearchString::parse("id:1,2,3");
    assert_eq!(ss.conditions.len(), 3);
    assert_eq!(ss.conditions[0], Condition { keyword: "id".to_string(), value: "1".to_string(), negated: false });
    assert_eq!(ss.conditions[1], Condition { keyword: "id".to_string(), value: "2".to_string(), negated: false });
    assert_eq!(ss.conditions[2], Condition { keyword: "id".to_string(), value: "3".to_string(), negated: false });
}

#[test]
fn test_complex_query() {
    let input = "-componentid:123 priority:P0,P1 \"urgent fix\" -status:fixed";
    let ss = SearchString::parse(input);
    
    let query = ss.get_parsed_query();
    assert_eq!(query.exclude.get("componentid").unwrap(), &vec!["123".to_string()]);
    assert_eq!(query.exclude.get("status").unwrap(), &vec!["fixed".to_string()]);
    assert_eq!(query.include.get("priority").unwrap(), &vec!["P0".to_string(), "P1".to_string()]);
    
    assert_eq!(ss.get_all_text(), "\"urgent fix\"");
}

#[test]
fn test_display_implementation() {
    let input = "to:me,you -from:joe description:\"quoted text\" \"stand alone text group\" some text";
    let ss = SearchString::parse(input);
    let output = ss.to_string();
    
    // The output might have a different order due to HashMap, but let's check it parses back correctly
    // The output might have a different order due to HashMap, but let's check it parses back correctly
    let ss2 = SearchString::parse(&output);
    assert_eq!(ss.conditions.len(), ss2.conditions.len());
    assert_eq!(ss.text_segments.len(), ss2.text_segments.len());
    // "stand alone text group", "some", "text" -> 3 segments
    assert_eq!(ss.text_segments.len(), 3);
    assert_eq!(ss.get_all_text(), ss2.get_all_text());
    
    let q1 = ss.get_parsed_query();
    let q2 = ss2.get_parsed_query();
    assert_eq!(q1.include, q2.include);
    assert_eq!(q1.exclude, q2.exclude);
}

#[test]
fn test_regex_values() {
    let ss = SearchString::parse("title:/^bug/ status:open");
    assert_eq!(ss.conditions.len(), 2);
    assert_eq!(ss.conditions[0].value, "/^bug/");
}

#[test]
fn test_text_segment_grouping() {
    let ss = SearchString::parse("this is \"a test\" lol");
    assert_eq!(ss.text_segments.len(), 4);
    assert_eq!(ss.text_segments[0].text, "this");
    assert_eq!(ss.text_segments[1].text, "is");
    assert_eq!(ss.text_segments[2].text, "a test");
    assert_eq!(ss.text_segments[3].text, "lol");
}

#[test]
fn test_is_empty() {
    let ss = SearchString::parse("");
    assert!(ss.is_empty());
    
    let ss2 = SearchString::parse("   ");
    assert!(ss2.is_empty());
    
    let ss3 = SearchString::parse("word");
    assert!(!ss3.is_empty());
    
    let ss4 = SearchString::parse("key:val");
    assert!(!ss4.is_empty());
}

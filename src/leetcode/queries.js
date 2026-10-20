// Every LeetCode request lives here. The API is unofficial and has changed before
// (problemsetQuestionList is gone), so when it changes again, this is the file to fix.

export const PROBLEM_LIST_PATH = '/api/problems/all/';

export const DAILY = `
  query daily {
    activeDailyCodingChallengeQuestion {
      date
      question { questionFrontendId titleSlug title difficulty }
    }
  }`;

export const QUESTION = `
  query question($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      content
      hints
      exampleTestcases
      metaData
      topicTags { name slug }
      codeSnippets { lang langSlug code }
    }
  }`;

export const SEARCH = `
  query search($keywords: String!) {
    questionList(categorySlug: "", limit: 10, skip: 0, filters: { searchKeywords: $keywords }) {
      data { questionId questionFrontendId titleSlug title difficulty isPaidOnly acRate }
    }
  }`;

export const USER_STATUS = `
  query userStatus {
    userStatus { isSignedIn username }
  }`;
